import 'package:flutter/foundation.dart';
import 'package:restaurant_guide_admin_web/models/admin_badges.dart';
import 'package:restaurant_guide_admin_web/services/account_scope.dart';
import 'package:restaurant_guide_admin_web/services/badges_service.dart';

/// Счётчики очередей для рейла и дашборда.
///
/// Живёт на уровне шелла: рейл рисуется один раз и переживает навигацию, а
/// счётчики нужны на каждом экране. Ошибку наружу не поднимает намеренно —
/// бейдж это украшение навигации, и падать из-за него экран не должен.
/// Не загрузилось — бейджей просто нет.
class BadgesProvider with ChangeNotifier {
  final BadgesService _service;

  AdminBadges? _badges;
  bool _isLoading = false;

  BadgesProvider({BadgesService? service})
      : _service = service ?? BadgesService() {
    AccountScope.register(resetAccountScope);
  }

  /// Сброс при смене аккаунта: счётчики перечитает шелл при следующем входе.
  void resetAccountScope() {
    _badges = null;
    _isLoading = false;
    notifyListeners();
  }

  AdminBadges? get badges => _badges;
  bool get isLoading => _isLoading;

  Future<void> load() async {
    if (_isLoading) return;
    _isLoading = true;

    try {
      _badges = await _service.getBadges();
    } catch (_) {
      // Молча: см. комментарий класса.
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }
}
