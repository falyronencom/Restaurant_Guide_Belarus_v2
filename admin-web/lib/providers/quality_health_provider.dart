import 'package:flutter/foundation.dart';
import 'package:restaurant_guide_admin_web/models/quality_health_models.dart';
import 'package:restaurant_guide_admin_web/services/account_scope.dart';
import 'package:restaurant_guide_admin_web/services/quality_health_service.dart';

/// Состояние панели «Здоровье данных» (AI-ops Brick-1, Tier-0, только чтение).
///
/// **Два вызывающих, а не один.** Кроме самого экрана снимок запрашивает
/// панель «Требует внимания» на дашборде: строка «Сигналов здоровья данных»
/// считается по тому же ответу. Отсюда счётчик поколений и защита от
/// повторного входа — без них два экрана, открытые подряд, дважды дёргали бы
/// тяжёлый эндпоинт, а поздний ответ первого запроса перетирал бы ранний
/// ответ второго.
class QualityHealthProvider with ChangeNotifier {
  final QualityHealthService _service;

  QualityHealthData? _data;
  bool _isLoading = false;
  String? _error;

  /// Растёт на каждый запрос. Ответ, чьё поколение отстало, выбрасывается:
  /// побеждает отправленный последним, а не ответивший последним.
  int _generation = 0;

  QualityHealthProvider({QualityHealthService? service})
      : _service = service ?? QualityHealthService() {
    AccountScope.register(resetAccountScope);
  }

  /// Сброс при смене аккаунта: снимок перечитается при следующем входе.
  /// Поколение сдвигается, чтобы летящий ответ был выброшен.
  void resetAccountScope() {
    _generation++;
    _data = null;
    _isLoading = false;
    _error = null;
    notifyListeners();
  }

  QualityHealthData? get data => _data;
  bool get isLoading => _isLoading;
  String? get error => _error;

  /// Загрузка снимка.
  ///
  /// [force] обходит серверный снимок — это кнопка «Обновить». Обычная
  /// загрузка при уже летящем запросе не отправляется: ответ один и тот же, и
  /// второй вызов лишь удвоил бы работу сервера. Принудительная — отправляется
  /// всегда, иначе нажатие в момент фоновой загрузки осталось бы без ответа, а
  /// кнопка без отклика читается как поломка.
  Future<void> load({bool force = false}) async {
    if (_isLoading && !force) return;

    final generation = ++_generation;
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final data = await _service.getHealth(force: force);
      if (generation != _generation) return;
      _data = data;
    } catch (e) {
      if (generation != _generation) return;
      _error = _extractMessage(e);
    } finally {
      // Флаг снимается только своим поколением: иначе принудительный запрос,
      // обогнавший фоновый, снял бы полосу загрузки, пока фоновый ещё летит.
      if (generation == _generation) {
        _isLoading = false;
        notifyListeners();
      }
    }
  }

  /// Кнопка «Обновить»: перечитать, минуя снимок сервера.
  Future<void> refresh() => load(force: true);

  String _extractMessage(Object error) {
    final msg = error.toString();
    if (msg.contains('Connection timeout')) return 'Превышено время ожидания';
    if (msg.contains('No internet')) return 'Нет подключения к серверу';
    if (msg.contains('403')) return 'Доступ запрещён';
    return 'Произошла ошибка. Попробуйте снова.';
  }
}
