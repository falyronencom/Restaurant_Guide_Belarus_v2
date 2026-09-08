import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:restaurant_guide_mobile/config/environment.dart';
import 'package:restaurant_guide_mobile/services/session_events.dart';

/// HTTP API client with authentication and error handling
/// Built on Dio with custom interceptors for token management
class ApiClient {
  final Dio _dio;
  final FlutterSecureStorage _storage;

  /// Lock to prevent concurrent token refresh attempts.
  /// When multiple requests get 401 simultaneously, only the first triggers
  /// a refresh — the rest wait for it. Without this, strict single-use
  /// token rotation detects "reuse" and invalidates ALL user tokens.
  Completer<bool>? _refreshCompleter;

  // Singleton pattern
  static final ApiClient _instance = ApiClient.withDio(_defaultDio());
  factory ApiClient() => _instance;

  /// Собирает клиент поверх готового Dio.
  ///
  /// Прод по-прежнему ходит через синглтон `ApiClient()` — поведение не
  /// изменилось. Конструктор нужен тестам перехватчиков: у класса с одним
  /// приватным конструктором нет точки входа, чтобы собрать его поверх
  /// подставного транспорта со своим, а не общим на процесс, замком
  /// обновления токена.
  ApiClient.withDio(Dio dio)
      : _dio = dio,
        _storage = const FlutterSecureStorage() {
    // Add interceptors
    _dio.interceptors.add(_createRequestInterceptor());
    _dio.interceptors.add(_createResponseInterceptor());
    _dio.interceptors.add(_createErrorInterceptor());

    // Add logging in development
    if (Environment.enableApiLogging) {
      _dio.interceptors.add(LogInterceptor(
        request: true,
        requestHeader: true,
        requestBody: true,
        responseHeader: false,
        responseBody: true,
        error: true,
        logPrint: (obj) => debugPrint('[API] $obj'),
      ));
    }
  }

  /// Транспорт прод-сборки: базовый адрес и таймауты из `Environment`.
  static Dio _defaultDio() => Dio(
        BaseOptions(
          baseUrl: Environment.apiBaseUrl,
          connectTimeout:
              const Duration(seconds: Environment.apiConnectTimeout),
          receiveTimeout: const Duration(seconds: Environment.apiTimeout),
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          // Format arrays as repeated keys: categories=A&categories=B
          // This matches Express query parser expectations
          listFormat: ListFormat.multiCompatible,
        ),
      );

  /// Get Dio instance for direct use
  Dio get dio => _dio;

  // ============================================================================
  // Request Interceptor - Adds authentication token
  // ============================================================================

  Interceptor _createRequestInterceptor() {
    return InterceptorsWrapper(
      onRequest: (options, handler) async {
        // Add authentication token if available
        final accessToken = await _storage.read(key: 'access_token');
        if (accessToken != null && accessToken.isNotEmpty) {
          options.headers['Authorization'] = 'Bearer $accessToken';
        }

        // Log request in development (without token)
        if (Environment.enableApiLogging) {
          debugPrint('[API Request] ${options.method} ${options.path}');
        }

        handler.next(options);
      },
    );
  }

  // ============================================================================
  // Response Interceptor - Handles token refresh
  // ============================================================================

  Interceptor _createResponseInterceptor() {
    return InterceptorsWrapper(
      onResponse: (response, handler) async {
        // Check if response contains new tokens
        if (response.data is Map<String, dynamic>) {
          final data = response.data as Map<String, dynamic>;

          if (data.containsKey('accessToken')) {
            await _storage.write(
              key: 'access_token',
              value: data['accessToken'],
            );
          }

          if (data.containsKey('refreshToken')) {
            await _storage.write(
              key: 'refresh_token',
              value: data['refreshToken'],
            );
          }
        }

        handler.next(response);
      },
    );
  }

  // ============================================================================
  // Error Interceptor - Handles errors and retries
  // ============================================================================

  /// Пути, чей 401 — отказ в учётных данных, а не истёкшая сессия: вход по
  /// паролю, вход через Google/Яндекс и само обновление токена.
  static const List<String> _credentialPaths = <String>[
    '/api/v1/auth/login',
    '/api/v1/auth/oauth',
    '/api/v1/auth/refresh',
  ];

  /// Метка в `extra`: запрос уже повторён после обновления токена.
  static const String _retriedAfterRefreshKey = 'retriedAfterRefresh';

  /// Текст отказа, когда обновить сессию больше нечем.
  static const String sessionExpiredMessage = 'Сеанс истёк. Войдите заново.';

  static bool _isCredentialRequest(RequestOptions options) =>
      _credentialPaths.any((path) => options.uri.path.endsWith(path));

  Interceptor _createErrorInterceptor() {
    return InterceptorsWrapper(
      onError: (error, handler) async {
        if (Environment.enableApiLogging) {
          debugPrint('[API Error] ${error.requestOptions.path}: ${error.message}');
        }

        // Handle 401 Unauthorized - try to refresh token.
        //
        // Кроме двух случаев. Первый — запросы за учётными данными. 401 на
        // вход значит «пароль не принят»: обновлять по нему нечем и незачем,
        // а раньше такой 401 уходил в эту же ветку и подменялся текстом про
        // истёкший сеанс. 401 на само обновление возвращался сюда же и ждал
        // `_refreshCompleter` — тот самый замок, который держит обновление,
        // ждущее этот ответ. Взаимная блокировка: первый защищённый запрос
        // после просроченного refresh-токена (30 дней без запуска) или
        // отключения аккаунта не завершался никогда, таймауты Dio не
        // помогали — ответ уже получен. Приложение висело на старте.
        // Второй — запрос, уже повторённый после успешного обновления: его
        // 401 — ответ по существу (неверный код подтверждения), а не
        // просроченный токен; иначе каждый повтор запускал обновление
        // заново, до потолка попыток на бэкенде. Таким запросам ответ
        // сервера отдаётся как есть.
        final alreadyRetried =
            error.requestOptions.extra[_retriedAfterRefreshKey] == true;
        if (error.response?.statusCode == 401 &&
            !_isCredentialRequest(error.requestOptions) &&
            !alreadyRetried) {
          final refreshed = await _attemptTokenRefresh();
          if (refreshed) {
            // Retry original request with new token
            error.requestOptions.extra[_retriedAfterRefreshKey] = true;
            try {
              final response = await _retry(error.requestOptions);
              return handler.resolve(response);
            } catch (e) {
              // Обновление удалось, а повтор — нет: наружу уходит отказ
              // самого повтора (с текстом сервера), а не исходный 401.
              return handler.reject(e is DioException ? e : error);
            }
          } else {
            // Обновить нечем: токены стёрты и провайдер оповещён в
            // `_attemptTokenRefresh` — один раз на цикл, сколько бы
            // запросов ни ждало этого обновления.
            return handler.reject(
              DioException(
                requestOptions: error.requestOptions,
                error: sessionExpiredMessage,
                type: DioExceptionType.badResponse,
              ),
            );
          }
        }

        // Handle 5xx server errors - retry with exponential backoff
        if (error.response != null &&
            error.response!.statusCode! >= 500 &&
            error.response!.statusCode! < 600) {
          final retryCount = error.requestOptions.extra['retryCount'] ?? 0;
          if (retryCount < Environment.maxRetryAttempts) {
            // Wait before retry (exponential backoff)
            final retryCountInt = retryCount as int;
            await Future.delayed(
                Duration(milliseconds: 500 * (retryCountInt + 1)));

            error.requestOptions.extra['retryCount'] = retryCount + 1;
            try {
              final response = await _retry(error.requestOptions);
              return handler.resolve(response);
            } catch (e) {
              return handler.reject(error);
            }
          }
        }

        // Enhance error message for user
        final enhancedError = _enhanceError(error);
        handler.reject(enhancedError);
      },
    );
  }

  // ============================================================================
  // Token Management
  // ============================================================================

  /// Attempt to refresh access token using refresh token.
  /// Uses a Completer lock so that concurrent 401 responses share a single
  /// refresh call. Without this, strict single-use token rotation on the
  /// backend detects "reuse" and invalidates ALL user tokens.
  ///
  /// Провал обновления обрабатывается здесь же и ровно один раз на цикл:
  /// токены стираются, `SessionEvents.reportExpired` уходит провайдеру
  /// авторизации. Ожидающие замка запросы получают только `false`.
  Future<bool> _attemptTokenRefresh() async {
    // If a refresh is already in progress, wait for its result
    final inFlight = _refreshCompleter;
    if (inFlight != null) {
      return inFlight.future;
    }

    final completer = Completer<bool>();
    _refreshCompleter = completer;

    var refreshed = false;
    try {
      refreshed = await _doTokenRefresh();
      if (!refreshed) {
        // Обновить нечем — сессия закончилась. Стереть токены до того, как
        // проснутся ожидающие: им уже нечего чистить и нечем повторять.
        await clearTokens();
      }
    } finally {
      _refreshCompleter = null;
      completer.complete(refreshed);
    }

    if (!refreshed) {
      // Хранилище пусто, обновить сессию больше нечем — об этом обязан
      // узнать провайдер авторизации, иначе он останется «вошедшим» с
      // пустым хранилищем. Слушатель сам отличает истёкшую сессию от
      // запроса без входа по своему состоянию.
      SessionEvents.reportExpired();
    }
    return refreshed;
  }

  /// Internal refresh logic — called only once per refresh cycle
  Future<bool> _doTokenRefresh() async {
    try {
      final refreshToken = await _storage.read(key: 'refresh_token');
      if (refreshToken == null || refreshToken.isEmpty) {
        return false;
      }

      final response = await _dio.post(
        '/api/v1/auth/refresh',
        data: {'refreshToken': refreshToken},
        options: Options(
          headers: {'Authorization': null}, // Don't send old access token
        ),
      );

      if (response.statusCode == 200 && response.data is Map<String, dynamic>) {
        final data = response.data as Map<String, dynamic>;
        // Backend wraps response: { success: true, data: { accessToken: ..., refreshToken: ... } }
        final responseData = data['data'] as Map<String, dynamic>? ?? data;
        if (responseData.containsKey('accessToken')) {
          await _storage.write(
            key: 'access_token',
            value: responseData['accessToken'] as String,
          );
          // Also update refresh token if provided
          if (responseData.containsKey('refreshToken')) {
            await _storage.write(
              key: 'refresh_token',
              value: responseData['refreshToken'] as String,
            );
          }
          return true;
        }
      }
      return false;
    } catch (e) {
      if (Environment.enableApiLogging) {
        debugPrint('[API] Token refresh failed: $e');
      }
      return false;
    }
  }

  /// Clear all stored tokens
  Future<void> clearTokens() async {
    await _storage.delete(key: 'access_token');
    await _storage.delete(key: 'refresh_token');
  }

  /// Check if user has valid token
  Future<bool> hasValidToken() async {
    final accessToken = await _storage.read(key: 'access_token');
    return accessToken != null && accessToken.isNotEmpty;
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /// Retry a request with updated configuration
  Future<Response> _retry(RequestOptions requestOptions) async {
    final options = Options(
      method: requestOptions.method,
      headers: requestOptions.headers,
      // `extra` несёт счётчик повторов. Без него повторный запрос
      // приходит в перехватчик с нулём, потолок не наступает никогда,
      // и любая ошибка 5xx повторяется бесконечно: гость видит вечную
      // загрузку — ни ошибки, ни пустого экрана, жаловаться не на что,
      // а бэкенд получает запрос каждые полсекунды. Railway отдаёт 5xx
      // на каждом деплое, так что случай не гипотетический.
      extra: requestOptions.extra,
    );

    return _dio.request(
      requestOptions.path,
      data: requestOptions.data,
      queryParameters: requestOptions.queryParameters,
      options: options,
    );
  }

  /// Enhance error with user-friendly message
  DioException _enhanceError(DioException error) {
    String userMessage;

    switch (error.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
        userMessage = 'Сервер не отвечает. Проверьте подключение.';
        break;

      case DioExceptionType.badResponse:
        userMessage = _extractErrorMessage(error.response);
        break;

      case DioExceptionType.cancel:
        userMessage = 'Запрос отменён.';
        break;

      case DioExceptionType.connectionError:
        userMessage = 'Нет связи. Проверьте подключение к интернету.';
        break;

      case DioExceptionType.unknown:
      default:
        userMessage = 'Что-то пошло не так. Попробуйте ещё раз.';
    }

    return DioException(
      requestOptions: error.requestOptions,
      response: error.response,
      type: error.type,
      error: userMessage,
    );
  }

  /// Field name translations (backend English → Russian)
  static const _fieldNames = <String, String>{
    'name': 'Название',
    'description': 'Описание',
    'city': 'Город',
    'address': 'Адрес',
    'latitude': 'Широта',
    'longitude': 'Долгота',
    'phone': 'Телефон',
    'email': 'Email',
    'website': 'Сайт',
    'categories': 'Категории',
    'cuisines': 'Кухни',
    'price_range': 'Ценовая категория',
    'working_hours': 'Время работы',
    'special_hours': 'Особые часы',
    'attributes': 'Атрибуты',
    'id': 'ID',
  };

  /// Validation message translations (backend English → Russian)
  static const _validationMessages = <String, String>{
    'Establishment name is required': 'Укажите название заведения',
    'Establishment name must be between 1 and 255 characters':
        'Название должно быть от 1 до 255 символов',
    'Establishment name cannot be empty': 'Название не может быть пустым',
    'Description must not exceed 2000 characters':
        'Описание не должно превышать 2000 символов',
    'City is required': 'Укажите город',
    'Address is required': 'Укажите адрес',
    'Address cannot be empty': 'Адрес не может быть пустым',
    'Address must be between 1 and 500 characters':
        'Адрес должен быть от 1 до 500 символов',
    'Latitude is required': 'Укажите координаты',
    'Latitude must be a valid number between 51.0 and 56.0 (Belarus bounds)':
        'Координаты за пределами Беларуси',
    'Longitude is required': 'Укажите координаты',
    'Longitude must be a valid number between 23.0 and 33.0 (Belarus bounds)':
        'Координаты за пределами Беларуси',
    'Phone must be in format +375XXXXXXXXX (Belarus number)':
        'Формат: +375 XX XXX XX XX',
    'Email must be a valid email address': 'Введите корректный email',
    'Website must be a valid URL': 'Введите корректную ссылку',
    'Categories must be an array with 1-2 items': 'Выберите 1–2 категории',
    'Cuisines must be an array with 1-3 items': 'Выберите 1–3 типа кухни',
    'Price range must be one of: \$, \$\$, \$\$\$':
        'Выберите ценовую категорию',
    'Working hours are required': 'Укажите время работы',
    'Working hours must be a valid JSON object':
        'Некорректный формат времени работы',
    'Special hours must be a valid JSON object':
        'Некорректный формат особых часов',
    'Attributes must be a valid JSON object': 'Некорректный формат атрибутов',
    'Establishment ID is required': 'ID заведения обязателен',
    'Establishment ID must be a valid UUID': 'Некорректный ID заведения',
  };

  /// Translate a validation message to Russian
  String _translateValidation(String field, String message) {
    final ruField = _fieldNames[field] ?? field;
    final ruMessage = _validationMessages[message] ?? message;
    return ruField.isNotEmpty ? '$ruField: $ruMessage' : ruMessage;
  }

  /// Extract error message from response
  String _extractErrorMessage(Response? response) {
    if (response == null) {
      return 'Ошибка сервера. Попробуйте позже.';
    }

    // Try to extract message from standardized error format
    if (response.data is Map<String, dynamic>) {
      final data = response.data as Map<String, dynamic>;

      // Check for backend standardized format
      if (data.containsKey('error')) {
        final error = data['error'];
        if (error is Map<String, dynamic>) {
          // Check for validation details array (422 responses)
          if (error.containsKey('details')) {
            final details = error['details'];
            if (details is List && details.isNotEmpty) {
              return details.map((d) {
                if (d is Map<String, dynamic>) {
                  final field = d['field'] as String? ?? '';
                  final msg = d['message'] as String? ?? '';
                  return _translateValidation(field, msg);
                }
                return d.toString();
              }).join('\n');
            }
          }
          if (error.containsKey('message')) {
            return error['message'] as String;
          }
        }
        if (error is String) {
          return error;
        }
      }

      // Check for message field
      if (data.containsKey('message')) {
        return data['message'] as String;
      }
    }

    // Fallback to status code message (Russian)
    switch (response.statusCode) {
      case 400:
        return 'Некорректный запрос. Проверьте введённые данные.';
      case 401:
        return 'Необходима авторизация. Войдите в аккаунт.';
      case 403:
        return 'Доступ запрещён.';
      case 404:
        return 'Ресурс не найден.';
      case 409:
        return 'Конфликт. Запись уже существует.';
      case 422:
        return 'Ошибка валидации. Проверьте введённые данные.';
      case 500:
      case 502:
      case 503:
        return 'Ошибка сервера. Попробуйте позже.';
      default:
        return 'Произошла ошибка (${response.statusCode}).';
    }
  }

  // ============================================================================
  // Convenience Methods
  // ============================================================================

  /// GET request
  Future<Response> get(
    String path, {
    Map<String, dynamic>? queryParameters,
    Options? options,
  }) async {
    return _dio.get(path, queryParameters: queryParameters, options: options);
  }

  /// POST request
  Future<Response> post(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
    Options? options,
  }) async {
    return _dio.post(
      path,
      data: data,
      queryParameters: queryParameters,
      options: options,
    );
  }

  /// PUT request
  Future<Response> put(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
    Options? options,
  }) async {
    return _dio.put(
      path,
      data: data,
      queryParameters: queryParameters,
      options: options,
    );
  }

  /// PATCH request
  Future<Response> patch(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
    Options? options,
  }) async {
    return _dio.patch(
      path,
      data: data,
      queryParameters: queryParameters,
      options: options,
    );
  }

  /// DELETE request
  Future<Response> delete(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
    Options? options,
  }) async {
    return _dio.delete(
      path,
      data: data,
      queryParameters: queryParameters,
      options: options,
    );
  }
}
