import 'package:flutter/foundation.dart';
import 'package:restaurant_guide_admin_web/models/analytics_models.dart';
import 'package:restaurant_guide_admin_web/services/account_scope.dart';
import 'package:restaurant_guide_admin_web/services/analytics_service.dart';

/// Итоги для полосы вкладок: «Заведения 412 · Пользователи 3 480 · Отзывы 1 240».
///
/// Отдельный запрос за `overview` вместо загрузки всех трёх вкладок сразу:
/// одно обращение вместо трёх, и оно уже существует. Величины — снимки, от
/// периода не зависят, поэтому при смене окна не перечитываются.
///
/// Числа здесь — только для ещё не открытых вкладок. Как только вкладка
/// загрузилась, полоса берёт её собственный `total`: два запроса видят базу в
/// разные моменты, и показывать в подписи одно число, а в карточке под ней
/// другое — хуже, чем не показывать никакого.
class AnalyticsTotalsProvider with ChangeNotifier {
  final AnalyticsService _service;

  OverviewData? _overview;
  bool _isLoading = false;

  AnalyticsTotalsProvider({AnalyticsService? service})
      : _service = service ?? AnalyticsService() {
    AccountScope.register(resetAccountScope);
  }

  /// Сброс при смене аккаунта: итоги перечитываются при следующем входе.
  void resetAccountScope() {
    _overview = null;
    _isLoading = false;
    notifyListeners();
  }

  int? get establishments => _overview?.establishments.total;
  int? get users => _overview?.users.total;
  int? get reviews => _overview?.reviews.total;

  Future<void> loadOnce() async {
    if (_overview != null || _isLoading) return;
    _isLoading = true;

    try {
      _overview = await _service.getOverview();
    } catch (_) {
      // Молча. Итог в подписи вкладки — удобство, а не содержание экрана:
      // сообщать об ошибке дважды (здесь и в теле вкладки) значило бы
      // объявить сбоем то, что сбоем не является.
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }
}
