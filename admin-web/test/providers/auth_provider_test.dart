import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/models/auth_response.dart';
import 'package:restaurant_guide_admin_web/models/user.dart';
import 'package:restaurant_guide_admin_web/providers/auth_provider.dart';
import 'package:restaurant_guide_admin_web/services/account_scope.dart';
import 'package:restaurant_guide_admin_web/services/auth_service.dart';
import 'package:restaurant_guide_admin_web/services/session_events.dart';

// Провайдер авторизации как источник события смены аккаунта.
//
// Проверяются три пути, на которых состояние прежнего оператора обязано
// исчезнуть из провайдеров: выход, истёкшая сессия (OSB-M I5) и вход под
// другим аккаунтом без выхода между ними. И роль «только просмотр»: входит,
// но действовать не может.

class _FakeAuthService implements AuthService {
  bool storedSession = false;
  User? storedUser;
  User? nextLoginUser;
  Object? loginError;
  int logoutCalls = 0;
  int clearCalls = 0;

  @override
  Future<bool> isAuthenticated() async => storedSession;

  @override
  Future<User> getCurrentUser() async => storedUser!;

  @override
  Future<AuthResponse> login({
    required String email,
    required String password,
  }) async {
    if (loginError != null) throw loginError!;
    return AuthResponse(
      accessToken: 'access',
      refreshToken: 'refresh',
      user: nextLoginUser!,
    );
  }

  @override
  Future<void> logout() async {
    logoutCalls++;
  }

  @override
  Future<void> clearAuthData() async {
    clearCalls++;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

const _admin = User(id: 'u-admin', email: 'admin@nirivio.by', role: 'admin');
const _viewer = User(id: 'u-viewer', email: 'guest@nirivio.by', role: 'viewer');
const _partner = User(id: 'u-partner', email: 'p@nirivio.by', role: 'partner');

void main() {
  late _FakeAuthService service;
  late int resets;

  setUp(() {
    AccountScope.debugReset();
    SessionEvents.debugReset();
    service = _FakeAuthService();
    resets = 0;
    AccountScope.register(() => resets++);
  });

  tearDown(AccountScope.debugReset);

  Future<AuthProvider> provider() async {
    final auth = AuthProvider(authService: service);
    addTearDown(auth.dispose);
    // `_initialize` асинхронный: даём ему дойти до первого `notifyListeners`.
    await pumpEventQueue();
    return auth;
  }

  group('Выход и смена аккаунта', () {
    test('выход сбрасывает реестр — до уведомления слушателей', () async {
      final auth = await provider();
      service.nextLoginUser = _admin;
      await auth.login(email: 'admin@nirivio.by', password: 'x');
      expect(auth.isAuthenticated, isTrue);

      var resetsAtNotify = -1;
      auth.addListener(() => resetsAtNotify = resets);
      await auth.logout();

      expect(auth.isAuthenticated, isFalse);
      expect(resets, 1);
      // Роутер уводит на вход по уведомлению; к этому моменту провайдеры уже
      // пусты — иначе экран за редиректом на кадр нёс бы чужую очередь.
      expect(resetsAtNotify, 1);
    });

    test('вход под другим аккаунтом без выхода сбрасывает реестр', () async {
      final auth = await provider();
      service.nextLoginUser = _admin;
      await auth.login(email: 'admin@nirivio.by', password: 'x');
      expect(resets, 0, reason: 'первый вход за запуск — сбрасывать нечего');

      service.nextLoginUser = _viewer;
      await auth.login(email: 'guest@nirivio.by', password: 'x');

      expect(resets, 1);
      expect(auth.currentUser?.id, 'u-viewer');
    });

    test('повторный вход тем же аккаунтом реестр не трогает', () async {
      final auth = await provider();
      service.nextLoginUser = _admin;
      await auth.login(email: 'admin@nirivio.by', password: 'x');
      await auth.login(email: 'admin@nirivio.by', password: 'x');

      expect(resets, 0);
    });
  });

  group('Истёкшая сессия (OSB-M I5)', () {
    test('событие переводит во «не вошёл», объясняет и сбрасывает реестр',
        () async {
      final auth = await provider();
      service.nextLoginUser = _admin;
      await auth.login(email: 'admin@nirivio.by', password: 'x');

      SessionEvents.reportExpired();

      expect(auth.isAuthenticated, isFalse);
      expect(auth.currentUser, isNull);
      expect(auth.errorMessage, 'Сессия истекла — войдите снова');
      expect(resets, 1);
    });

    test('вне авторизованного состояния событие игнорируется', () async {
      // Неудачный вход тоже проходит через ветку транспорта, которая
      // сообщает об истёкшей сессии; провайдер отличает его по состоянию.
      final auth = await provider();

      SessionEvents.reportExpired();

      expect(auth.isAuthenticated, isFalse);
      expect(auth.errorMessage, isNull);
      expect(resets, 0);
    });

    test('после dispose провайдер событие не слушает', () async {
      final auth = AuthProvider(authService: service);
      await pumpEventQueue();
      service.nextLoginUser = _admin;
      await auth.login(email: 'admin@nirivio.by', password: 'x');

      auth.dispose();

      expect(SessionEvents.reportExpired, returnsNormally);
      expect(resets, 0);
    });
  });

  group('Роль «только просмотр»', () {
    test('входит, но действовать не может', () async {
      final auth = await provider();
      service.nextLoginUser = _viewer;

      final ok = await auth.login(email: 'guest@nirivio.by', password: 'x');

      expect(ok, isTrue);
      expect(auth.isAuthenticated, isTrue);
      expect(auth.canModerate, isFalse);
      expect(auth.isViewer, isTrue);
    });

    test('администратор действует', () async {
      final auth = await provider();
      service.nextLoginUser = _admin;

      await auth.login(email: 'admin@nirivio.by', password: 'x');

      expect(auth.canModerate, isTrue);
      expect(auth.isViewer, isFalse);
    });

    test('сохранённая сессия просмотрщика принимается при старте', () async {
      service.storedSession = true;
      service.storedUser = _viewer;

      final auth = await provider();

      expect(auth.isAuthenticated, isTrue);
      expect(auth.canModerate, isFalse);
      expect(service.clearCalls, 0);
    });

    test('сохранённая сессия чужой роли стирается при старте', () async {
      service.storedSession = true;
      service.storedUser = _partner;

      final auth = await provider();

      expect(auth.isAuthenticated, isFalse);
      expect(service.clearCalls, 1);
    });
  });

  group('Текст отказа во входе', () {
    // Провайдер узнаёт причину по фразе сервера внутри ошибки транспорта.
    // Перехватчик обязан пропустить её как есть: подменённая на «Please log
    // in again» она даёт общую «Ошибку входа» — так и было до правки
    // перехватчика (test/services/api_client_credentials_401_test.dart).
    test('«Invalid email/phone or password» → «Неверный email или пароль»',
        () async {
      final auth = await provider();
      service.loginError = DioException(
        requestOptions: RequestOptions(path: '/api/v1/admin/auth/login'),
        type: DioExceptionType.badResponse,
        error: 'Invalid email/phone or password',
      );

      final ok = await auth.login(email: 'admin@nirivio.by', password: 'typo');

      expect(ok, isFalse);
      expect(auth.isAuthenticated, isFalse);
      expect(auth.errorMessage, 'Неверный email или пароль');
    });

    test('подменённый текст про повторный вход даёт общую ошибку', () async {
      final auth = await provider();
      service.loginError = DioException(
        requestOptions: RequestOptions(path: '/api/v1/admin/auth/login'),
        type: DioExceptionType.badResponse,
        error: 'Authentication failed. Please log in again.',
      );

      await auth.login(email: 'admin@nirivio.by', password: 'typo');

      // Закрепляет, ПОЧЕМУ перехватчик не должен подменять ответ входа:
      // из этой фразы провайдеру причину не восстановить.
      expect(auth.errorMessage, 'Ошибка входа. Попробуйте снова.');
    });
  });
}
