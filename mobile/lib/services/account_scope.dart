import 'package:flutter/foundation.dart';

/// Registry of reset callbacks for account-scoped provider state.
///
/// Providers that cache per-account data (partner establishments, bookings,
/// notifications, favorites) register their reset once in the constructor.
/// The auth layer calls [resetAll] on logout and when a login binds a
/// different account than the previous one in this app run — so no screen
/// can render data cached for another user.
class AccountScope {
  AccountScope._();

  static final List<VoidCallback> _resets = [];

  /// Providers live for the whole app run, so there is no unregister path.
  static void register(VoidCallback reset) => _resets.add(reset);

  static void resetAll() {
    for (final reset in _resets) {
      reset();
    }
  }

  /// Test isolation only — forget everything registered so far.
  @visibleForTesting
  static void debugReset() => _resets.clear();

  /// Сколько сбросов зарегистрировано — для сквозного сторожа.
  ///
  /// Реестр молчалив по устройству: провайдер, забывший про
  /// [register], не меняет ни строчки вывода прогона, а после смены
  /// аккаунта показывает данные прежнего. Сторож обязан уметь
  /// пересчитать подписчиков, иначе он проверяет только сам себя.
  @visibleForTesting
  static int get debugRegisteredCount => _resets.length;
}
