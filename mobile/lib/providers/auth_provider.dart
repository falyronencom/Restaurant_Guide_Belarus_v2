import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:restaurant_guide_mobile/models/user.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';
import 'package:restaurant_guide_mobile/services/auth_service.dart';
import 'package:restaurant_guide_mobile/services/session_events.dart';

/// Authentication status enum
enum AuthenticationStatus {
  /// User is not authenticated
  unauthenticated,

  /// Authentication operation in progress
  authenticating,

  /// User is authenticated
  authenticated,

  /// User is in verification process (SMS/email)
  verifying,
}

/// Authentication state provider
/// Manages user authentication status and profile data
class AuthProvider with ChangeNotifier, WidgetsBindingObserver {
  final AuthService _authService;

  // ============================================================================
  // State
  // ============================================================================

  AuthenticationStatus _status = AuthenticationStatus.unauthenticated;
  User? _currentUser;

  /// Last account id bound in this app run; guards account-switch resets.
  String? _lastAccountId;
  bool _isLoading = false;
  String? _errorMessage;

  // Registration state
  String? _verificationToken;
  String? _pendingEmail;
  String? _pendingPhone;
  String? _authMethod; // 'email' or 'phone'

  StreamSubscription<void>? _sessionExpiredSubscription;

  AuthProvider({AuthService? authService})
      : _authService = authService ?? AuthService() {
    _sessionExpiredSubscription =
        SessionEvents.expired.listen((_) => _onSessionExpired());
    WidgetsBinding.instance.addObserver(this);
    _initialize();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _sessionExpiredSubscription?.cancel();
    super.dispose();
  }

  // ============================================================================
  // Getters
  // ============================================================================

  /// Current authentication status
  AuthenticationStatus get status => _status;

  /// Whether user is authenticated
  bool get isAuthenticated => _status == AuthenticationStatus.authenticated;

  /// Whether operation is in progress
  bool get isLoading => _isLoading;

  /// Current error message
  String? get errorMessage => _errorMessage;

  /// Current authenticated user
  User? get currentUser => _currentUser;

  /// Verification token from registration
  String? get verificationToken => _verificationToken;

  /// Pending email awaiting verification
  String? get pendingEmail => _pendingEmail;

  /// Pending phone awaiting verification
  String? get pendingPhone => _pendingPhone;

  /// Authentication method being used
  String? get authMethod => _authMethod;

  // ============================================================================
  // Initialization
  // ============================================================================

  /// Initialize authentication state
  /// Checks for stored tokens and validates session
  Future<void> _initialize() async {
    _setLoading(true);

    try {
      final hasToken = await _authService.isAuthenticated();

      if (hasToken) {
        // Try to get current user to validate token
        try {
          final user = await _authService.getCurrentUser();
          _bindAccount(user);
          _status = AuthenticationStatus.authenticated;
        } catch (e) {
          final errorStr = e.toString();
          // Транспорт стирает токены, когда обновить сессию нечем
          // (просроченный refresh-токен, отключённый аккаунт). Пустое
          // хранилище после отказа надёжнее разбора текста: у
          // пересобранного DioException в toString() нет кода статуса.
          final tokensGone = !await _authService.isAuthenticated();
          // Only clear auth data if token is actually invalid (401)
          // Don't clear on rate limit (429) or network errors
          if (tokensGone ||
              errorStr.contains('401') ||
              errorStr.contains('Unauthorized')) {
            _status = AuthenticationStatus.unauthenticated;
            _currentUser = null;
            await _authService.clearAuthData();
          } else if (errorStr.contains('429')) {
            // Rate limited - keep token, assume authenticated
            // User can refresh later
            _status = AuthenticationStatus.authenticated;
          } else {
            // Network or other error - keep token but mark as unauthenticated
            // Don't clear data, allow retry
            _status = AuthenticationStatus.unauthenticated;
          }
        }
      }
    } catch (e) {
      _setError('Failed to initialize authentication');
      _status = AuthenticationStatus.unauthenticated;
    } finally {
      _setLoading(false);
    }
  }

  /// Возврат приложения на экран — повод проверить сессию ещё раз.
  ///
  /// При отказе сети `_initialize` оставляет токены, но переводит провайдера в
  /// «не вошёл» и больше не пробует. Старт без связи — в метро, в самолёте, в
  /// окно деплоя бэкенда — делал вошедшего пользователя гостем до перезапуска
  /// приложения. Возврат на экран — момент, когда связь обычно уже есть.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed) return;
    _recheckSessionOnResume();
  }

  Future<void> _recheckSessionOnResume() async {
    // «Вошёл» не трогаем: перепроверять нечего, а запрос профиля на каждом
    // возврате из фона — трафик на ровном месте.
    if (isAuthenticated || _isLoading) return;
    try {
      // Токенов нет — пользователь и правда гость, а не жертва отказа сети:
      // проверять нечем.
      if (!await _authService.isAuthenticated()) return;
      // Условия перепроверяются ПОСЛЕ чтения хранилища: за это время мог
      // завершиться вход или стартовать другая проверка, а условия выше
      // проверены до `await`. Без повторной проверки отказ сети сбросил бы
      // только что вошедшего обратно в гостя, а два возврата подряд дали бы
      // два запроса профиля: `_initialize` держит [_isLoading] поднятым всё
      // время работы, и второй заход упирается именно в него.
      if (isAuthenticated || _isLoading) return;
      await _initialize();
    } catch (_) {
      // Обработчик жизненного цикла зовёт эту проверку без `await`: любое
      // исключение отсюда (чтение защищённого хранилища тоже умеет падать)
      // стало бы необработанной асинхронной ошибкой на каждом возврате
      // приложения на экран.
    }
  }

  // ============================================================================
  // Registration Flow
  // ============================================================================

  /// Register new user with email
  Future<bool> registerWithEmail({
    required String email,
    required String password,
    String? name,
  }) async {
    _setLoading(true);
    _clearError();
    _status = AuthenticationStatus.authenticating;
    notifyListeners();

    try {
      final response = await _authService.register(
        email: email,
        password: password,
        authMethod: 'email',
        name: name,
      );

      // Check if backend returned direct auth tokens (no verification needed)
      if (response.hasDirectAuth && response.user != null) {
        _bindAccount(User.fromJson(response.user!));
        _status = AuthenticationStatus.authenticated;
        _setLoading(false);
        return true;
      }

      // Otherwise, store verification details for later use
      _pendingEmail = email;
      _authMethod = 'email';
      _status = AuthenticationStatus.verifying;
      _setLoading(false);

      return true;
    } catch (e) {
      _setError(_extractErrorMessage(e));
      _status = AuthenticationStatus.unauthenticated;
      _setLoading(false);
      return false;
    }
  }

  /// Register new user with phone
  Future<bool> registerWithPhone({
    required String phone,
    required String password,
    String? name,
  }) async {
    _setLoading(true);
    _clearError();
    _status = AuthenticationStatus.authenticating;
    notifyListeners();

    try {
      final response = await _authService.register(
        phone: phone,
        password: password,
        authMethod: 'phone',
        name: name,
      );

      // Check if backend returned direct auth tokens (no verification needed)
      if (response.hasDirectAuth && response.user != null) {
        _bindAccount(User.fromJson(response.user!));
        _status = AuthenticationStatus.authenticated;
        _setLoading(false);
        return true;
      }

      // Otherwise, store verification token and details
      _verificationToken = response.verificationToken;
      _pendingPhone = phone;
      _authMethod = 'phone';
      _status = AuthenticationStatus.verifying;
      _setLoading(false);

      return true;
    } catch (e) {
      _setError(_extractErrorMessage(e));
      _status = AuthenticationStatus.unauthenticated;
      _setLoading(false);
      return false;
    }
  }

  /// Verify SMS code
  Future<bool> verifyCode({required String code}) async {
    if (_verificationToken == null) {
      _setError('No verification token available');
      return false;
    }

    _setLoading(true);
    _clearError();

    try {
      final authResponse = await _authService.verifyCode(
        code: code,
        verificationToken: _verificationToken!,
      );

      _bindAccount(authResponse.user);
      _status = AuthenticationStatus.authenticated;
      _clearVerificationState();
      _setLoading(false);

      return true;
    } catch (e) {
      _setError(_extractErrorMessage(e));
      _setLoading(false);
      return false;
    }
  }

  /// Verify email with token
  Future<bool> verifyEmail({required String emailToken}) async {
    _setLoading(true);
    _clearError();

    try {
      final authResponse = await _authService.verifyEmail(
        emailToken: emailToken,
      );

      _bindAccount(authResponse.user);
      _status = AuthenticationStatus.authenticated;
      _clearVerificationState();
      _setLoading(false);

      return true;
    } catch (e) {
      _setError(_extractErrorMessage(e));
      _setLoading(false);
      return false;
    }
  }

  /// Check verification status (for email verification polling)
  Future<bool> checkVerificationStatus() async {
    if (!isAuthenticated) {
      try {
        final user = await _authService.getCurrentUser();
        if (user.isVerified) {
          _bindAccount(user);
          _status = AuthenticationStatus.authenticated;
          _clearVerificationState();
          notifyListeners();
          return true;
        }
      } catch (e) {
        // Not verified yet or error
        return false;
      }
    }
    return false;
  }

  /// Send (or re-send) an email verification code to the authenticated user.
  /// Returns true on success, false if rate-limited or other server error.
  /// Sets [errorMessage] with a localized message when false.
  Future<bool> sendEmailVerificationCode() async {
    _setLoading(true);
    _clearError();

    try {
      await _authService.sendEmailVerificationCode();
      _setLoading(false);
      return true;
    } catch (e) {
      _setError(_extractErrorMessage(e));
      _setLoading(false);
      return false;
    }
  }

  /// Verify a 6-digit email verification code submitted by the user.
  /// On success, refreshes the stored user (email_verified=true) and returns true.
  Future<bool> verifyEmailCode({required String code}) async {
    _setLoading(true);
    _clearError();

    try {
      final user = await _authService.verifyEmailCode(code: code);
      _bindAccount(user);
      _status = AuthenticationStatus.authenticated;
      _clearVerificationState();
      _setLoading(false);
      notifyListeners();
      return true;
    } catch (e) {
      _setError(_extractErrorMessage(e));
      _setLoading(false);
      return false;
    }
  }

  /// Resend verification code
  Future<bool> resendVerification() async {
    if (_authMethod == null) {
      _setError('No authentication method set');
      return false;
    }

    _setLoading(true);
    _clearError();

    try {
      final response = await _authService.resendVerification(
        email: _pendingEmail,
        phone: _pendingPhone,
        authMethod: _authMethod!,
      );

      // Update verification token if phone method
      if (_authMethod == 'phone') {
        _verificationToken = response.verificationToken;
      }

      _setLoading(false);
      return true;
    } catch (e) {
      _setError(_extractErrorMessage(e));
      _setLoading(false);
      return false;
    }
  }

  // ============================================================================
  // Login Flow
  // ============================================================================

  /// Login with email or phone and password
  Future<bool> login({
    required String emailOrPhone,
    required String password,
  }) async {
    _setLoading(true);
    _clearError();
    _status = AuthenticationStatus.authenticating;
    notifyListeners();

    try {
      final authResponse = await _authService.login(
        emailOrPhone: emailOrPhone,
        password: password,
      );

      _bindAccount(authResponse.user);
      _status = AuthenticationStatus.authenticated;
      _setLoading(false);

      return true;
    } catch (e) {
      _setError(_extractErrorMessage(e));
      _status = AuthenticationStatus.unauthenticated;
      _setLoading(false);
      return false;
    }
  }

  // ============================================================================
  // OAuth Login Flow
  // ============================================================================

  /// Login with Google Sign-In
  Future<bool> loginWithGoogle() async {
    _setLoading(true);
    _clearError();
    _status = AuthenticationStatus.authenticating;
    notifyListeners();

    try {
      final authResponse = await _authService.loginWithGoogle();

      _bindAccount(authResponse.user);
      _status = AuthenticationStatus.authenticated;
      _setLoading(false);

      return true;
    } catch (e) {
      _setError(_extractErrorMessage(e));
      _status = AuthenticationStatus.unauthenticated;
      _setLoading(false);
      return false;
    }
  }

  /// Login with Yandex OAuth
  Future<bool> loginWithYandex() async {
    _setLoading(true);
    _clearError();
    _status = AuthenticationStatus.authenticating;
    notifyListeners();

    try {
      final authResponse = await _authService.loginWithYandex();

      _bindAccount(authResponse.user);
      _status = AuthenticationStatus.authenticated;
      _setLoading(false);

      return true;
    } catch (e) {
      _setError(_extractErrorMessage(e));
      _status = AuthenticationStatus.unauthenticated;
      _setLoading(false);
      return false;
    }
  }

  /// Logout current user
  Future<void> logout() async {
    _setLoading(true);

    try {
      await _authService.logout();
    } catch (e) {
      // Continue with local logout even if API call fails
    }

    _currentUser = null;
    _status = AuthenticationStatus.unauthenticated;
    _clearError();
    _clearVerificationState();

    // Wipe account-scoped provider caches (partner cards, bookings, etc.) —
    // otherwise the next signed-in user sees the previous account's data.
    AccountScope.resetAll();
    _lastAccountId = null;

    _setLoading(false);

    notifyListeners();
  }

  // ============================================================================
  // Session expiry
  // ============================================================================

  /// Транспорт не смог обновить токен и очистил хранилище. До этого сигнала
  /// провайдер оставался «вошедшим» с пустым хранилищем: профиль показывал
  /// данные, за которыми уже нельзя сходить, а каждое действие отвечало
  /// «Сеанс истёк». Теперь — «не вошёл», со сброшенными кэшами аккаунта и
  /// без локальных остатков сессии.
  ///
  /// Сигнал приходит и от запроса без входа (refresh-токена нет — обновлять
  /// нечем), и во время инициализации с мёртвой сессией; в этих состояниях
  /// менять нечего. Только «вошёл» превращается в «не вошёл».
  Future<void> _onSessionExpired() async {
    if (_status != AuthenticationStatus.authenticated) return;
    _currentUser = null;
    _status = AuthenticationStatus.unauthenticated;
    _clearVerificationState();
    AccountScope.resetAll();
    _lastAccountId = null;
    notifyListeners();
    // Токены уже стёр транспорт; здесь — остаток сессии (user_data).
    await _authService.clearAuthData();
  }

  // ============================================================================
  // Profile Management
  // ============================================================================

  /// Refresh current user data
  Future<void> refreshUser() async {
    if (!isAuthenticated) return;

    try {
      final user = await _authService.getCurrentUser();
      _bindAccount(user);
      notifyListeners();
    } catch (e) {
      // If refresh fails, user might be logged out
      if (e.toString().contains('401') ||
          e.toString().contains('Authentication')) {
        await logout();
      }
    }
  }

  /// Updates user role after backend role change (e.g., user → partner)
  /// Called after receiving new tokens with updated role
  /// Uses local state update without network call for speed and reliability
  Future<void> updateUserRole(String newRole) async {
    if (_currentUser != null) {
      debugPrint('AuthProvider: Updating role from ${_currentUser!.role} to $newRole');
      _currentUser = _currentUser!.copyWith(role: newRole);
      _status = AuthenticationStatus.authenticated;
      notifyListeners();
      debugPrint('AuthProvider: User role updated to $newRole');
    }
  }

  /// Update user profile
  Future<bool> updateProfile({
    String? name,
    String? avatarUrl,
  }) async {
    if (!isAuthenticated) return false;

    _setLoading(true);
    _clearError();

    try {
      final user = await _authService.updateProfile(
        name: name,
        avatarUrl: avatarUrl,
      );

      _bindAccount(user);
      _setLoading(false);

      return true;
    } catch (e) {
      _setError(_extractErrorMessage(e));
      _setLoading(false);
      return false;
    }
  }

  /// Upload avatar image
  Future<bool> uploadAvatar(String filePath) async {
    if (!isAuthenticated) return false;

    _setLoading(true);
    _clearError();

    try {
      final user = await _authService.uploadAvatar(filePath);
      _bindAccount(user);
      _setLoading(false);
      return true;
    } catch (e) {
      _setError(_extractErrorMessage(e));
      _setLoading(false);
      return false;
    }
  }

  /// Change password
  Future<bool> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async {
    if (!isAuthenticated) return false;

    _setLoading(true);
    _clearError();

    try {
      await _authService.changePassword(
        currentPassword: currentPassword,
        newPassword: newPassword,
      );

      _setLoading(false);
      return true;
    } catch (e) {
      _setError(_extractErrorMessage(e));
      _setLoading(false);
      return false;
    }
  }

  /// Request password reset
  Future<bool> requestPasswordReset({required String email}) async {
    _setLoading(true);
    _clearError();

    try {
      await _authService.requestPasswordReset(email);
      _setLoading(false);
      return true;
    } catch (e) {
      _setError(_extractErrorMessage(e));
      _setLoading(false);
      return false;
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /// Bind the authenticated [user] as the active account. When the account
  /// differs from the previous one in this app run, account-scoped provider
  /// state is reset first — covers logins without an explicit logout between.
  void _bindAccount(User user) {
    if (_lastAccountId != null && _lastAccountId != user.id) {
      AccountScope.resetAll();
    }
    _lastAccountId = user.id;
    _currentUser = user;
  }

  /// Set loading state
  void _setLoading(bool loading) {
    _isLoading = loading;
    notifyListeners();
  }

  /// Set error message
  void _setError(String message) {
    _errorMessage = message;
    notifyListeners();
  }

  /// Clear error message
  void _clearError() {
    _errorMessage = null;
  }

  /// Clear verification state
  void _clearVerificationState() {
    _verificationToken = null;
    _pendingEmail = null;
    _pendingPhone = null;
    _authMethod = null;
  }

  /// Extract user-friendly error message from exception
  String _extractErrorMessage(Object error) {
    final errorStr = error.toString();

    // Extract message from DioException format
    if (errorStr.contains('DioException')) {
      // Try to extract the actual error message
      final match = RegExp(r'error:\s*(.+?)(?:\n|$)').firstMatch(errorStr);
      if (match != null) {
        return match.group(1) ?? 'Ошибка авторизации';
      }
    }

    // OAuth-specific errors
    if (errorStr.contains('cancelled') || errorStr.contains('CANCELED')) {
      return 'Вход отменён';
    }
    if (errorStr.contains('not configured')) {
      return 'Этот способ входа ещё не настроен';
    }

    // Common error patterns
    // Фразы сервера здесь обязательны: у DioException, пересобранного
    // транспортом, в toString() нет ни кода статуса, ни кода из тела ответа
    // (INVALID_CREDENTIALS, INVALID_CODE) — только текст из `error`.
    if (errorStr.contains('401') ||
        errorStr.contains('Unauthorized') ||
        errorStr.contains('Authentication failed') ||
        errorStr.contains('INVALID_CREDENTIALS') ||
        errorStr.contains('Invalid email/phone or password')) {
      return 'Неверный email/телефон или пароль';
    }
    if (errorStr.contains('Email already registered') ||
        errorStr.contains('EMAIL_TAKEN') ||
        errorStr.contains('EMAIL_EXISTS')) {
      return 'Этот email уже зарегистрирован. Попробуйте войти.';
    }
    if (errorStr.contains('Phone already registered') ||
        errorStr.contains('PHONE_TAKEN') ||
        errorStr.contains('PHONE_EXISTS')) {
      return 'Этот номер телефона уже зарегистрирован. Попробуйте войти.';
    }
    if (errorStr.contains('Invalid verification code') ||
        errorStr.contains('Verification code is incorrect') ||
        errorStr.contains('INVALID_CODE')) {
      return 'Неверный код подтверждения. Проверьте и попробуйте снова.';
    }
    if (errorStr.contains('INVALID_OR_EXPIRED_CODE')) {
      return 'Код истёк или недействителен. Запросите новый.';
    }
    if (errorStr.contains('TOO_MANY_ATTEMPTS')) {
      return 'Слишком много неверных попыток. Запросите новый код.';
    }
    if (errorStr.contains('EMAIL_ALREADY_VERIFIED')) {
      return 'Email уже подтверждён.';
    }
    if (errorStr.contains('NO_EMAIL')) {
      return 'На аккаунте нет email-адреса.';
    }
    if (errorStr.contains('Code expired') || errorStr.contains('CODE_EXPIRED')) {
      return 'Код подтверждения истёк. Запросите новый код.';
    }
    if (errorStr.contains('404')) {
      return 'Сервис недоступен. Попробуйте позже.';
    }
    if (errorStr.contains('429') || errorStr.contains('Too many requests')) {
      return 'Слишком много попыток. Подождите немного и попробуйте снова.';
    }
    if (errorStr.contains('500')) {
      return 'Ошибка сервера. Попробуйте позже.';
    }
    if (errorStr.contains('Network') || errorStr.contains('Connection')) {
      return 'Ошибка сети. Проверьте подключение к интернету.';
    }

    return 'Произошла ошибка. Попробуйте снова.';
  }
}
