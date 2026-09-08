import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/models/auth_response.dart';
import 'package:restaurant_guide_mobile/models/user.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';
import 'package:restaurant_guide_mobile/services/auth_service.dart';
import 'package:restaurant_guide_mobile/services/session_events.dart';

import '../support/secure_storage_stand.dart';
import '../support/wire_stand.dart';

/// Провайдер авторизации и конец сессии.
///
/// Транспорт стирает токены, когда обновить их нечем, — но провайдер об этом
/// не знал: оставался «вошедшим» с пустым хранилищем, профиль показывал
/// данные, за которыми уже нельзя сходить. Теперь транспорт подаёт сигнал
/// `SessionEvents.expired`, а провайдер переводит себя в «не вошёл», сбрасывает
/// кэши аккаунта и стирает остаток сессии.
///
/// Вторая половина — текст отказа во входе. Провайдер узнаёт причину по фразе
/// сервера внутри ошибки транспорта: у `DioException` в `toString()` нет ни
/// кода статуса, ни кода `INVALID_CREDENTIALS` из тела ответа — только текст
/// из `error`. Перехватчик обязан пропустить фразу как есть, а таблица
/// провайдера — знать её.
class _FakeAuthService implements AuthService {
  bool storedSession = false;
  User? storedUser;
  Object? loginError;
  Object? verifyCodeError;
  int clearCalls = 0;

  static const _user = User(id: 'u-1', email: 'guest@example.com');

  @override
  Future<bool> isAuthenticated() async => storedSession;

  @override
  Future<User> getCurrentUser() async {
    final user = storedUser;
    if (user == null) throw Exception('no session');
    return user;
  }

  @override
  Future<AuthResponse> login({
    required String emailOrPhone,
    required String password,
  }) async {
    if (loginError != null) throw loginError!;
    return const AuthResponse(
      accessToken: 'access',
      refreshToken: 'refresh',
      user: _user,
    );
  }

  @override
  Future<User> verifyEmailCode({required String code}) async {
    if (verifyCodeError != null) throw verifyCodeError!;
    return _user;
  }

  @override
  Future<void> clearAuthData() async {
    clearCalls++;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const user = User(id: 'u-1', email: 'guest@example.com', name: 'Гость');

  setUp(() {
    SessionEvents.debugReset();
    AccountScope.debugReset();
  });

  /// Ждёт конца инициализации. Таймаут — ограничитель против зависания:
  /// до правки перехватчика инициализация с мёртвой сессией не завершалась
  /// никогда, и тест без предела не падал бы, а висел.
  Future<void> settled(
    AuthProvider auth, {
    Duration limit = const Duration(seconds: 3),
  }) {
    if (!auth.isLoading) return Future.value();
    final done = Completer<void>();
    void listener() {
      if (!auth.isLoading && !done.isCompleted) done.complete();
    }

    auth.addListener(listener);
    return done.future
        .timeout(
          limit,
          onTimeout: () => throw StateError(
            'провайдер не вышел из загрузки за $limit: инициализация зависла',
          ),
        )
        .whenComplete(() => auth.removeListener(listener));
  }

  Future<AuthProvider> provider(_FakeAuthService service) async {
    final auth = AuthProvider(authService: service);
    addTearDown(auth.dispose);
    await settled(auth);
    return auth;
  }

  /// Ошибка в той форме, в какой её отдаёт транспорт: текст сервера в
  /// `error`, тело ответа — в `response`.
  DioException rejected(String path, String code, String message) {
    final options = RequestOptions(path: path);
    return DioException(
      requestOptions: options,
      response: Response(
        requestOptions: options,
        statusCode: 401,
        data: {
          'success': false,
          'error': {'code': code, 'message': message},
        },
      ),
      type: DioExceptionType.badResponse,
      error: message,
    );
  }

  group('Сигнал об истёкшей сессии', () {
    test('вошедший → не вошёл: пользователь снят, кэши сброшены, остаток стёрт',
        () async {
      final service = _FakeAuthService()
        ..storedSession = true
        ..storedUser = user;
      final auth = await provider(service);
      expect(auth.isAuthenticated, isTrue, reason: 'предусловие');
      var resets = 0;
      AccountScope.register(() => resets++);
      var notified = 0;
      auth.addListener(() => notified++);

      SessionEvents.reportExpired();

      expect(auth.status, AuthenticationStatus.unauthenticated);
      expect(auth.currentUser, isNull);
      expect(resets, 1,
          reason: 'следующий вход может быть под другим аккаунтом — кэши '
              'прежнего обязаны исчезнуть');
      expect(notified, 1,
          reason: 'экраны узнают о смене состояния в тот же момент');
      await pumpEventQueue();
      expect(service.clearCalls, 1,
          reason: 'токены стёр транспорт, user_data — провайдер');
    });

    test('сигнал без входа и повторный сигнал ничего не меняют', () async {
      // Сигнал приходит и от запроса без входа: refresh-токена нет,
      // обновлять нечем. Провайдеру в этом состоянии менять нечего.
      final service = _FakeAuthService();
      final auth = await provider(service);
      var resets = 0;
      AccountScope.register(() => resets++);
      var notified = 0;
      auth.addListener(() => notified++);

      SessionEvents.reportExpired();
      SessionEvents.reportExpired();
      await pumpEventQueue();

      expect(auth.status, AuthenticationStatus.unauthenticated);
      expect(notified, 0);
      expect(resets, 0);
      expect(service.clearCalls, 0);
    });
  });

  group('Текст отказа', () {
    test('«Invalid email/phone or password» → «Неверный email/телефон или пароль»',
        () async {
      final service = _FakeAuthService()
        ..loginError = rejected(
          '/api/v1/auth/login',
          'INVALID_CREDENTIALS',
          'Invalid email/phone or password',
        );
      final auth = await provider(service);

      final ok = await auth.login(
        emailOrPhone: 'guest@example.com',
        password: 'typo',
      );

      expect(ok, isFalse);
      expect(auth.isAuthenticated, isFalse);
      expect(auth.errorMessage, 'Неверный email/телефон или пароль');
    });

    test('подменённый текст про истёкший сеанс даёт общую ошибку', () async {
      // Закрепляет, ПОЧЕМУ перехватчик не должен подменять ответ входа: из
      // «Сеанс истёк» провайдеру причину не восстановить — так и было до
      // правки (test/services/api_client_credentials_401_test.dart).
      final service = _FakeAuthService()
        ..loginError = DioException(
          requestOptions: RequestOptions(path: '/api/v1/auth/login'),
          type: DioExceptionType.badResponse,
          error: 'Сеанс истёк. Войдите заново.',
        );
      final auth = await provider(service);

      await auth.login(emailOrPhone: 'guest@example.com', password: 'typo');

      expect(auth.errorMessage, 'Произошла ошибка. Попробуйте снова.');
    });

    test('«Verification code is incorrect» → «Неверный код подтверждения…»',
        () async {
      // После правки перехватчика 401 INVALID_CODE доходит до провайдера как
      // ответ сервера (раньше — шторм «обновить и повторить» до
      // TOO_MANY_ATTEMPTS). Фразы сервера в таблице не было, а код
      // INVALID_CODE в toString() не попадает.
      final service = _FakeAuthService()
        ..verifyCodeError = rejected(
          '/api/v1/auth/verify-email-code',
          'INVALID_CODE',
          'Verification code is incorrect',
        );
      final auth = await provider(service);

      final ok = await auth.verifyEmailCode(code: '000000');

      expect(ok, isFalse);
      expect(auth.errorMessage,
          'Неверный код подтверждения. Проверьте и попробуйте снова.');
    });
  });

  group('Старт с сохранённой, но мёртвой сессией', () {
    // Единственный тест поверх настоящих `AuthService()` и `ApiClient()`:
    // сценарий «30 дней без запуска» проходит все три слоя, подменяются
    // только транспорт и хранилище. До правки `_initialize` ждал
    // `getCurrentUser()`, тот — обновление токена, а оно — само себя: сплэш
    // крутил кольцо до своего таймаута, провайдер оставался «в загрузке»
    // навсегда. Тест стоит последним: на старом коде он оставляет замок
    // синглтона занятым.
    test('провайдер выходит из загрузки как «не вошёл», хранилище пусто',
        () async {
      installWireStand(
        (options) => options.uri.path.endsWith('/auth/refresh')
            ? jsonBody({
                'success': false,
                'error': {
                  'code': 'TOKEN_EXPIRED',
                  'message': 'Refresh token has expired. Please log in again.',
                },
              }, status: 401)
            : jsonBody({
                'success': false,
                'message': 'Access token has expired',
                'error': {'code': 'TOKEN_EXPIRED'},
              }, status: 401),
      );
      final storage = installSecureStorageStand({
        'access_token': 'stale',
        'refresh_token': 'expired',
        'user_data': '{id: u-1}',
      });

      final auth = AuthProvider();
      addTearDown(auth.dispose);
      await settled(auth);

      expect(auth.status, AuthenticationStatus.unauthenticated);
      expect(auth.currentUser, isNull);
      expect(storage, isEmpty,
          reason: 'токены стёр транспорт, user_data — провайдер');
    });
  });
}
