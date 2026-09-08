import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/services/api_client.dart';
import 'package:restaurant_guide_mobile/services/session_events.dart';

import '../support/secure_storage_stand.dart';
import '../support/wire_stand.dart';

/// 401 на запросах за учётными данными — отказ, а не истёкшая сессия.
///
/// Перехватчик клиента одним кодом ответа обслуживает разные вещи. Защищённый
/// запрос получил 401 — надо обновить токен, а если нечем, стереть токены и
/// сообщить провайдеру. Сам вход или само обновление получили 401 — учётные
/// данные не приняты, обновлять нечего. До правки обе шли одной веткой, и
/// это давало три дефекта:
///
///  1. Взаимная блокировка. 401 от `/auth/refresh` попадал в тот же
///     перехватчик, видел незавершённый `_refreshCompleter` и ждал его; а
///     завершиться тот мог только после ответа на этот самый запрос.
///     Просроченный refresh-токен (30 дней без запуска) или отключённый
///     аккаунт — и первый защищённый запрос не завершался никогда; таймауты
///     Dio не помогали, ответ уже был получен. Приложение висело на старте.
///  2. Подмена текста. 401 на вход с опечаткой в пароле шёл в обновление,
///     обновлять было нечем, и наружу уходило «Сеанс истёк. Войдите заново.»
///     вместо ответа сервера — провайдер по такому тексту причину не
///     восстанавливал и показывал общую ошибку.
///  3. Шторм «обновить и повторить». 401 по существу (неверный код
///     подтверждения) на уже повторённом запросе снова запускал обновление:
///     каждая итерация вращала refresh-токен и жгла попытку кода.
///
/// Транспорт подставной с ограничителем числа запросов, ожидание — с
/// таймаутом: старый перехватчик обязан падать, а не висеть. Хранилище —
/// карта в памяти за каналом плагина: перехватчики читают, пишут и стирают
/// токены через него.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Map<String, String> storage;
  var expired = 0;

  setUp(() {
    storage = installSecureStorageStand();
    expired = 0;
    SessionEvents.debugReset();
    SessionEvents.expired.listen((_) => expired++);
  });

  ApiClient client(StubAdapter adapter) {
    final dio = Dio(BaseOptions(baseUrl: 'https://stub.invalid'))
      ..httpClientAdapter = adapter;
    return ApiClient.withDio(dio);
  }

  /// Отказ контроллера: `{ success, error: { code, message } }`.
  Map<String, dynamic> rejected(String code, String message) => {
        'success': false,
        'error': {'code': code, 'message': message},
      };

  /// Отказ middleware `authenticate`: текст на верхнем уровне, в `error`
  /// только код — так любой защищённый эндпоинт отвечает на истёкший
  /// access-токен.
  Map<String, dynamic> middlewareRejected(String code, String message) => {
        'success': false,
        'message': message,
        'error': {'code': code},
      };

  /// Успешное обновление: `{ success, data: { accessToken, refreshToken } }`.
  Map<String, dynamic> rotated(String access, String refresh) => {
        'success': true,
        'data': {'accessToken': access, 'refreshToken': refresh},
      };

  ResponseBody expiredAccess() => jsonBody(
        middlewareRejected('TOKEN_EXPIRED', 'Access token has expired'),
        status: 401,
      );

  ResponseBody expiredRefresh() => jsonBody(
        rejected(
          'TOKEN_EXPIRED',
          'Refresh token has expired. Please log in again.',
        ),
        status: 401,
      );

  bool isRefresh(RequestOptions options) =>
      options.uri.path.endsWith('/auth/refresh');

  const limit = Duration(seconds: 3);

  /// Ошибка запроса как значение. Таймаут — ограничитель против зависания:
  /// старый перехватчик ждал сам себя, и без предела тест не падал бы, а
  /// висел до потолка `flutter test`.
  Future<Object?> failure(Future<Response<dynamic>> request) => request
      .timeout(
        limit,
        onTimeout: () => throw StateError(
          'запрос не завершился за $limit: перехватчик ждёт собственный ответ',
        ),
      )
      .then<Object?>((_) => null, onError: (Object e) => e);

  List<String> paths(StubAdapter adapter) =>
      adapter.requests.map((r) => r.uri.path).toList();

  /// Отказ обязан быть отказом транспорта, а не таймаутом ожидания и не
  /// ограничителем стенда.
  DioException asDio(Object? error) {
    expect(error, isA<DioException>(),
        reason: 'запрос завис или зациклился, а не завершился отказом: $error');
    return error as DioException;
  }

  group('Просроченный refresh-токен', () {
    test('защищённый запрос завершается отказом, а не виснет', () async {
      storage['access_token'] = 'stale';
      storage['refresh_token'] = 'expired';
      final adapter = StubAdapter(
        (options) => isRefresh(options) ? expiredRefresh() : expiredAccess(),
        maxRequests: 8,
      );
      final api = client(adapter);

      final error = asDio(await failure(api.get('/api/v1/auth/me')));

      expect(error.error, ApiClient.sessionExpiredMessage);
      expect(
        paths(adapter),
        ['/api/v1/auth/me', '/api/v1/auth/refresh'],
        reason: '401 от самого обновления не должен ни ждать обновления, '
            'ни запускать его снова',
      );
      expect(storage.containsKey('access_token'), isFalse);
      expect(storage.containsKey('refresh_token'), isFalse);
      expect(expired, 1,
          reason: 'провайдер узнаёт об истёкшей сессии ровно один раз');
    });

    test('два параллельных 401: одно обновление, один сигнал, оба отказа',
        () async {
      // Замок `_refreshCompleter` обязан остаться: бэкенд вращает
      // refresh-токен одноразово, и второе обновление тем же токеном он
      // считает повторным использованием — гасит все сессии пользователя.
      storage['access_token'] = 'stale';
      storage['refresh_token'] = 'expired';
      final adapter = StubAdapter(
        (options) => isRefresh(options) ? expiredRefresh() : expiredAccess(),
        maxRequests: 8,
      );
      final api = client(adapter);

      final errors = await Future.wait([
        failure(api.get('/api/v1/favorites')),
        failure(api.get('/api/v1/notifications')),
      ]);

      for (final error in errors) {
        expect(asDio(error).error, ApiClient.sessionExpiredMessage);
      }
      expect(paths(adapter).where((p) => p.endsWith('/auth/refresh')).length, 1,
          reason: 'второй 401 ждёт первое обновление, а не запускает своё');
      expect(paths(adapter).length, 3);
      expect(expired, 1, reason: 'сигнал один на цикл, а не на запрос');
      expect(storage, isEmpty);
    });

    test('без refresh-токена: обновление не запрашивается, сигнал один',
        () async {
      storage['access_token'] = 'stale';
      final adapter = StubAdapter((_) => expiredAccess(), maxRequests: 8);
      final api = client(adapter);

      final error = asDio(await failure(api.get('/api/v1/auth/me')));

      expect(error.error, ApiClient.sessionExpiredMessage);
      expect(paths(adapter), ['/api/v1/auth/me']);
      expect(storage, isEmpty);
      expect(expired, 1);
    });
  });

  group('401 на входе — ответ сервера как есть', () {
    for (final path in const ['/api/v1/auth/login', '/api/v1/auth/oauth']) {
      test('$path: без обновления и без сигнала', () async {
        final adapter = StubAdapter(
          (_) => jsonBody(
            rejected('INVALID_CREDENTIALS', 'Invalid email/phone or password'),
            status: 401,
          ),
          maxRequests: 8,
        );
        final api = client(adapter);

        final error = asDio(await failure(api.post(
          path,
          data: {'email': 'probe@example.com', 'password': 'typo'},
        )));

        expect(error.error, 'Invalid email/phone or password',
            reason: 'провайдер переводит именно эту фразу в «Неверный '
                'email/телефон или пароль»; подмена текстом про истёкший '
                'сеанс даёт общую ошибку');
        expect(error.response?.statusCode, 401);
        expect(paths(adapter), [path],
            reason: 'по отказу во входе обновлять токен нечем');
        expect(expired, 0, reason: 'неудачный вход — не истёкшая сессия');
      });
    }

    test('при живой сессии другого аккаунта вход не повторяется, токены целы',
        () async {
      // Вход без выхода — поддерживаемый путь (`_bindAccount` сбрасывает
      // кэши при смене id). Старый перехватчик по 401 входа обновлял токен
      // живой сессии, повторял вход с тем же паролем, получал 401 — и так
      // по кругу, вращая refresh-токен на каждом витке.
      storage['access_token'] = 'alive';
      storage['refresh_token'] = 'alive-r';
      final adapter = StubAdapter(
        (options) => isRefresh(options)
            ? jsonBody(rotated('rotated', 'rotated-r'))
            : jsonBody(
                rejected(
                  'INVALID_CREDENTIALS',
                  'Invalid email/phone or password',
                ),
                status: 401,
              ),
        maxRequests: 8,
      );
      final api = client(adapter);

      final error = asDio(await failure(api.post(
        '/api/v1/auth/login',
        data: {'email': 'other@example.com', 'password': 'typo'},
      )));

      expect(error.error, 'Invalid email/phone or password');
      expect(paths(adapter), ['/api/v1/auth/login']);
      expect(storage['access_token'], 'alive',
          reason: 'чужая опечатка не трогает живую сессию');
      expect(storage['refresh_token'], 'alive-r');
      expect(expired, 0);
    });
  });

  group('Повтор после успешного обновления', () {
    test('обновлённый токен подставляется, ответ повтора уходит наружу',
        () async {
      storage['access_token'] = 'stale';
      storage['refresh_token'] = 'valid';
      final adapter = StubAdapter(
        (options) {
          if (isRefresh(options)) return jsonBody(rotated('fresh', 'fresh-r'));
          return options.headers['Authorization'] == 'Bearer fresh'
              ? jsonBody({
                  'success': true,
                  'data': {
                    'user': {'id': 'u-1'},
                  },
                })
              : expiredAccess();
        },
        maxRequests: 8,
      );
      final api = client(adapter);

      final response = await api.get('/api/v1/auth/me').timeout(limit);

      expect(response.statusCode, 200);
      expect(
        paths(adapter),
        ['/api/v1/auth/me', '/api/v1/auth/refresh', '/api/v1/auth/me'],
      );
      expect(adapter.requests.last.headers['Authorization'], 'Bearer fresh');
      expect(storage['access_token'], 'fresh');
      expect(storage['refresh_token'], 'fresh-r');
      expect(expired, 0);
    });

    test('401 по существу на повторе не запускает обновление снова',
        () async {
      // Неверный код подтверждения: бэкенд отвечает 401 INVALID_CODE на
      // авторизованном эндпоинте. Старый перехватчик обновлял токен и
      // повторял запрос с тем же кодом — каждый виток вращал refresh-токен
      // и жёг попытку кода; после пяти бэкенд отвечает TOO_MANY_ATTEMPTS.
      // Одна опечатка выжигала все попытки.
      storage['access_token'] = 'valid';
      storage['refresh_token'] = 'valid-r';
      final adapter = StubAdapter(
        (options) => isRefresh(options)
            ? jsonBody(rotated('fresh', 'fresh-r'))
            : jsonBody(
                rejected('INVALID_CODE', 'Verification code is incorrect'),
                status: 401,
              ),
        maxRequests: 8,
      );
      final api = client(adapter);

      final error = asDio(await failure(api.post(
        '/api/v1/auth/verify-email-code',
        data: {'code': '000000'},
      )));

      expect(error.error, 'Verification code is incorrect',
          reason: 'наружу уходит отказ повтора с текстом сервера, а не '
              'исходный 401 без текста');
      expect(error.response?.statusCode, 401);
      expect(
        paths(adapter),
        [
          '/api/v1/auth/verify-email-code',
          '/api/v1/auth/refresh',
          '/api/v1/auth/verify-email-code',
        ],
        reason: 'одно обновление, один повтор — и стоп',
      );
      expect(storage['access_token'], 'fresh',
          reason: 'обновление удалось — сессия жива, токены новые');
      expect(expired, 0);
    });
  });
}
