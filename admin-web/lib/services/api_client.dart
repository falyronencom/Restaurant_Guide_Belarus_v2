import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:restaurant_guide_admin_web/config/environment.dart';
import 'package:restaurant_guide_admin_web/services/session_events.dart';

/// HTTP API client with authentication and error handling
/// Built on Dio with custom interceptors for token management
class ApiClient {
  final Dio _dio;
  final FlutterSecureStorage _storage;

  /// Замок обновления токена: параллельные 401 делят ОДНО обновление.
  ///
  /// Refresh-токен на бэкенде одноразовый: второе обновление тем же токеном
  /// сервер считает повторным использованием и отзывает все токены
  /// пользователя. Без замка четыре запроса дашборда, получив 401 разом
  /// после четырёх часов простоя, запускали бы четыре обновления — первое
  /// проходило, остальные три выжигали сессию. Образец — mobile.
  Completer<bool>? _refreshCompleter;

  // Singleton pattern
  static final ApiClient _instance = ApiClient.withDio(_defaultDio());
  factory ApiClient() => _instance;

  /// Собирает клиент поверх готового Dio.
  ///
  /// Прод по-прежнему ходит через синглтон `ApiClient()` — поведение не
  /// изменилось. Конструктор доступен потому, что класс с одним лишь
  /// приватным генеративным конструктором нельзя ни собрать поверх
  /// подставного транспорта, ни унаследовать: в тестах не остаётся ни одной
  /// точки входа.
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
          listFormat: ListFormat.multiCompatible,
        ),
      );

  // ============================================================================
  // Request Interceptor - Adds authentication token
  // ============================================================================

  Interceptor _createRequestInterceptor() {
    return InterceptorsWrapper(
      onRequest: (options, handler) async {
        final accessToken = await _storage.read(key: 'access_token');
        if (accessToken != null && accessToken.isNotEmpty) {
          options.headers['Authorization'] = 'Bearer $accessToken';
        }
        handler.next(options);
      },
    );
  }

  // ============================================================================
  // Response Interceptor - Extracts and stores tokens from responses
  // ============================================================================

  Interceptor _createResponseInterceptor() {
    return InterceptorsWrapper(
      onResponse: (response, handler) async {
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
  // Error Interceptor - Handles 401 refresh and 5xx retry
  // ============================================================================

  /// Пути, чей 401 — отказ в учётных данных, а не истёкшая сессия: сам вход
  /// (панельный и общий) и само обновление токена.
  static const List<String> _credentialPaths = <String>[
    '/api/v1/admin/auth/login',
    '/api/v1/auth/login',
    '/api/v1/auth/refresh',
  ];

  static bool _isCredentialRequest(RequestOptions options) =>
      _credentialPaths.any((path) => options.uri.path.endsWith(path));

  /// Метка запроса, уже повторённого после обновления токена. Его 401 —
  /// ответ по существу (право отозвано, роль изменилась), а не истёкшая
  /// сессия: второе обновление и второй повтор дали бы цикл без дна.
  static const String _retriedAfterRefresh = 'retriedAfterRefresh';

  Interceptor _createErrorInterceptor() {
    return InterceptorsWrapper(
      onError: (error, handler) async {
        // Handle 401 Unauthorized - try to refresh token.
        //
        // Кроме запросов за учётными данными: 401 на сам вход означает
        // «пароль не принят», а не «сессия истекла», и обновлять по нему
        // токен нечем и незачем. Раньше такой 401 уходил в эту же ветку и
        // подменялся текстом про повторный вход — опечатавшийся видел общую
        // «Ошибку входа» вместо «Неверный email или пароль». А 401 на само
        // обновление возвращался сюда же и запускал обновление заново, пока
        // сервер не отвечал 429: просроченный refresh-токен превращался в
        // шторм запросов. Ответ сервера таким запросам отдаётся как есть.
        // И кроме уже повторённого запроса (см. [_retriedAfterRefresh]).
        if (error.response?.statusCode == 401 &&
            !_isCredentialRequest(error.requestOptions) &&
            error.requestOptions.extra[_retriedAfterRefresh] != true) {
          final refreshed = await _attemptTokenRefresh();
          if (refreshed) {
            error.requestOptions.extra[_retriedAfterRefresh] = true;
            try {
              final response = await _retry(error.requestOptions);
              return handler.resolve(response);
            } on DioException catch (e) {
              // Отказ повтора — настоящий ответ сервера на свежий токен;
              // отдаём его, а не исходный 401 без текста.
              return handler.reject(e);
            } catch (_) {
              return handler.reject(error);
            }
          } else {
            // Хранилище уже очищено владельцем замка, провайдер уведомлён
            // (OSB-M I5) — здесь только отказ запросу.
            return handler.reject(
              DioException(
                requestOptions: error.requestOptions,
                error: 'Authentication failed. Please log in again.',
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

        final enhancedError = _enhanceError(error);
        handler.reject(enhancedError);
      },
    );
  }

  // ============================================================================
  // Token Management
  // ============================================================================

  /// Обновить токен один раз на всех, кто получил 401 одновременно.
  ///
  /// Владелец замка выполняет обновление и, если оно провалилось, сам
  /// чистит хранилище и сообщает провайдеру об истёкшей сессии — ровно один
  /// раз на цикл. Ожидающие получают только результат. Запрос обновления
  /// идёт через тот же `Dio`, но его собственный 401 сюда не возвращается:
  /// путь исключён в [_isCredentialRequest], иначе замок ждал бы сам себя.
  Future<bool> _attemptTokenRefresh() {
    final inFlight = _refreshCompleter;
    if (inFlight != null) return inFlight.future;

    final completer = Completer<bool>();
    _refreshCompleter = completer;
    () async {
      var refreshed = false;
      try {
        refreshed = await _doTokenRefresh();
      } catch (_) {
        refreshed = false;
      }
      if (!refreshed) {
        await clearTokens();
        // Хранилище пусто, обновить сессию больше нечем — об этом обязан
        // узнать провайдер авторизации, иначе он останется «вошедшим»
        // с пустым хранилищем (OSB-M I5). Слушатель сам отличает
        // истёкшую сессию от неудачного входа по своему состоянию.
        SessionEvents.reportExpired();
      }
      _refreshCompleter = null;
      completer.complete(refreshed);
    }();
    return completer.future;
  }

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
          headers: {'Authorization': null},
        ),
      );

      if (response.statusCode == 200 &&
          response.data is Map<String, dynamic>) {
        final data = response.data as Map<String, dynamic>;
        final responseData = data['data'] as Map<String, dynamic>? ?? data;
        if (responseData.containsKey('accessToken')) {
          await _storage.write(
            key: 'access_token',
            value: responseData['accessToken'] as String,
          );
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

  Future<Response> _retry(RequestOptions requestOptions) async {
    // `extra` обязан переехать в повтор: в нём метка [_retriedAfterRefresh]
    // и счётчик `retryCount` для 5xx. До 09.09.2026 повтор собирался без
    // него — метка терялась, а счётчик каждый раз начинался с нуля, и
    // упорно падающий эндпоинт повторялся бы без предела.
    final options = Options(
      method: requestOptions.method,
      headers: requestOptions.headers,
      extra: requestOptions.extra,
    );
    return _dio.request(
      requestOptions.path,
      data: requestOptions.data,
      queryParameters: requestOptions.queryParameters,
      options: options,
    );
  }

  DioException _enhanceError(DioException error) {
    String userMessage;

    switch (error.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
        userMessage =
            'Connection timeout. Please check your internet connection.';
        break;
      case DioExceptionType.badResponse:
        userMessage = _extractErrorMessage(error.response);
        break;
      case DioExceptionType.cancel:
        userMessage = 'Request cancelled.';
        break;
      case DioExceptionType.connectionError:
        userMessage = 'No internet connection. Please check your network.';
        break;
      case DioExceptionType.unknown:
      default:
        userMessage = 'An unexpected error occurred. Please try again.';
    }

    return DioException(
      requestOptions: error.requestOptions,
      response: error.response,
      type: error.type,
      error: userMessage,
    );
  }

  String _extractErrorMessage(Response? response) {
    if (response == null) {
      return 'Server error occurred. Please try again later.';
    }

    if (response.data is Map<String, dynamic>) {
      final data = response.data as Map<String, dynamic>;
      if (data.containsKey('error')) {
        final error = data['error'];
        if (error is Map<String, dynamic> && error.containsKey('message')) {
          return error['message'] as String;
        }
        if (error is String) {
          return error;
        }
      }
      if (data.containsKey('message')) {
        return data['message'] as String;
      }
    }

    switch (response.statusCode) {
      case 400:
        return 'Invalid request. Please check your input.';
      case 401:
        return 'Authentication required. Please log in.';
      case 403:
        return 'Access denied.';
      case 404:
        return 'Resource not found.';
      case 422:
        return 'Validation error. Please check your input.';
      case 500:
      case 502:
      case 503:
        return 'Server error. Please try again later.';
      default:
        return 'Error occurred (${response.statusCode}).';
    }
  }

  // ============================================================================
  // Convenience Methods
  // ============================================================================

  Future<Response> get(
    String path, {
    Map<String, dynamic>? queryParameters,
    Options? options,
  }) async {
    return _dio.get(path, queryParameters: queryParameters, options: options);
  }

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
