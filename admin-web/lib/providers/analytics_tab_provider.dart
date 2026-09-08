import 'package:flutter/foundation.dart';
import 'package:restaurant_guide_admin_web/services/account_scope.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/period_selector.dart';

/// Общее устройство вкладки аналитики: данные, период, ошибка, загрузка.
///
/// Три вкладки отличались только типом ответа и вызовом сервиса, а
/// повторяли друг друга полностью — включая ошибки. Здесь общая часть одна,
/// и потому исправляется тоже один раз.
///
/// Период принадлежит РАЗДЕЛУ, а не вкладке: сегмент-контрол стоит в шапке
/// экрана, один на все три. Поэтому провайдер умеет отдельно «запомнить
/// выбранный период» ([setPeriod]) и «догрузиться, если отстал»
/// ([loadIfStale]): менять период у трёх вкладок сразу дёшево, а ходить за
/// данными для двух невидимых — нет.
abstract class AnalyticsTabProvider<T> with ChangeNotifier {
  /// Регистрация сброса здесь, в базовом классе: три вкладки отличаются
  /// только запросом, и забыть сброс в одной из них было бы тем самым
  /// «пятнадцатым провайдером», о котором предупреждал реестр отложенных.
  AnalyticsTabProvider() {
    AccountScope.register(resetAccountScope);
  }

  T? _data;
  bool _isLoading = false;
  String? _error;
  PeriodSelection _selection = const PeriodSelection(period: '30d');

  /// Период, за который посчитаны лежащие данные.
  ///
  /// Хранится целиком, а не одним ключом, потому что подпись экрана обязана
  /// описывать то, что на экране. Склеенная из окна ДАННЫХ и базы сравнения из
  /// ВЫБОРА, она после неудачного обновления утверждала бы «12 июля — 10
  /// августа · сравнение с предыдущими 7 днями»: два несовместимых периода в
  /// одной строке, оба выглядящие достоверно.
  PeriodSelection? _loadedSelection;

  /// Счётчик поколений. Ответ на отменённый запрос обязан быть выброшен:
  /// без этого выигрывает ответивший последним, а не запрошенный последним —
  /// класс дефекта, который в этом проекте ловили уже трижды.
  int _generation = 0;

  /// Ключ периода, за которым прямо сейчас летит запрос.
  ///
  /// Без него уход с вкладки и возврат на неё во время загрузки посылает
  /// второй запрос за тем же самым: данные ещё старые, вкладка формально
  /// отстала, и [loadIfStale] честно идёт за новыми — которые уже едут.
  String? _inFlightKey;

  T? get data => _data;
  bool get isLoading => _isLoading;
  String? get error => _error;
  String get period => _selection.period;
  PeriodSelection get selection => _selection;

  /// Период, описывающий лежащие данные. `null` — данных ещё нет.
  PeriodSelection? get loadedSelection => _loadedSelection;

  /// Данные есть, но посчитаны за другой период.
  bool get isStale => _loadedSelection?.key != _selection.key;

  /// Запрос к API. Единственное, что отличает вкладки друг от друга.
  Future<T> fetch(PeriodSelection selection);

  /// Запомнить выбранный период, не ходя за данными.
  void setPeriod(PeriodSelection selection) {
    if (selection.key == _selection.key) return;
    _selection = selection;
    notifyListeners();
  }

  /// Загрузить, если данных ещё нет или они за другой период.
  Future<void> loadIfStale() async {
    if (_inFlightKey == _selection.key) return;
    if (_data != null && !isStale) return;
    await load();
  }

  /// Загрузить принудительно — первый вход, смена периода, повтор после сбоя.
  Future<void> load([PeriodSelection? selection]) async {
    if (selection != null) _selection = selection;
    final requested = _selection;
    final generation = ++_generation;

    _isLoading = true;
    _inFlightKey = requested.key;
    _error = null;
    notifyListeners();

    try {
      final result = await fetch(requested);
      if (generation != _generation) return;
      _data = result;
      _loadedSelection = requested;
    } catch (e) {
      if (generation != _generation) return;
      _error = extractMessage(e);
    } finally {
      if (generation == _generation) {
        _isLoading = false;
        _inFlightKey = null;
        notifyListeners();
      }
    }
  }

  /// Сброс при смене аккаунта: данные, период и ошибка принадлежат
  /// вошедшему. Поколение сдвигается, чтобы летящий ответ был выброшен.
  void resetAccountScope() {
    _generation++;
    _data = null;
    _isLoading = false;
    _error = null;
    _selection = const PeriodSelection(period: '30d');
    _loadedSelection = null;
    _inFlightKey = null;
    notifyListeners();
  }

  @protected
  String extractMessage(Object error) {
    final msg = error.toString();
    if (msg.contains('Connection timeout')) return 'Превышено время ожидания';
    if (msg.contains('No internet')) return 'Нет подключения к серверу';
    if (msg.contains('403')) return 'Доступ запрещён';
    return 'Произошла ошибка. Попробуйте снова.';
  }
}
