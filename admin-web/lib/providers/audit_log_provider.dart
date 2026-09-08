import 'package:flutter/foundation.dart';
import 'package:restaurant_guide_admin_web/models/audit_log_entry.dart';
import 'package:restaurant_guide_admin_web/services/account_scope.dart';
import 'package:restaurant_guide_admin_web/services/audit_log_service.dart';

/// State management for the Audit Log viewer screen
class AuditLogProvider extends ChangeNotifier {
  final AuditLogService _service;

  AuditLogProvider({AuditLogService? service})
      : _service = service ?? AuditLogService() {
    AccountScope.register(resetAccountScope);
  }

  static const int perPage = 20;

  /// Период по умолчанию. Совпадает с тем, что подсвечено в сегмент-контроле:
  /// до этапа 5 контрол показывал «30 дней», а запрос уходил без границ дат —
  /// подсветка обещала фильтр, которого не было.
  static const String defaultPeriod = '30d';

  // List state
  List<AuditLogEntry> _entries = [];
  bool _isLoading = false;
  String? _error;
  int _currentPage = 1;
  int _totalPages = 1;
  int _totalCount = 0;

  /// Метка самой свежей записи текущей выборки.
  ///
  /// Берётся с первой страницы и переживает перелистывание: «последняя» — это
  /// свойство выборки, а не открытой страницы, и на третьей странице она не
  /// становится трёхдневной давности. Сбрасывается при смене фильтров вместе
  /// с самой выборкой.
  DateTime? _latestAt;

  // Filters
  String? _actionFilter;
  String? _entityTypeFilter;
  String _period = defaultPeriod;
  DateTime? _customFrom;
  DateTime? _customTo;

  // Expanded row (for showing old_data/new_data details)
  String? _expandedEntryId;

  // Getters
  List<AuditLogEntry> get entries => _entries;
  bool get isLoading => _isLoading;
  String? get error => _error;
  int get currentPage => _currentPage;
  int get totalPages => _totalPages;
  int get totalCount => _totalCount;
  DateTime? get latestAt => _latestAt;
  String? get actionFilter => _actionFilter;
  String? get entityTypeFilter => _entityTypeFilter;
  String get period => _period;
  DateTime? get customFrom => _customFrom;
  DateTime? get customTo => _customTo;
  String? get expandedEntryId => _expandedEntryId;

  /// Выбрано ли хоть что-то, кроме периода по умолчанию.
  ///
  /// Период сюда не входит намеренно: он выбран всегда, и «сбросить» его
  /// значит вернуть к тем же 30 дням. Кнопка сброса, горящая при пустом
  /// наборе фильтров, обещает действие без последствий.
  bool get hasActiveFilters =>
      _actionFilter != null ||
      _entityTypeFilter != null ||
      _period != defaultPeriod;

  /// Границы периода считаются в момент запроса, а не при выборе.
  ///
  /// Вкладка админки живёт открытой сутками; окно, посчитанное один раз при
  /// старте, к утру означало бы уже не «30 дней», а «30 дней по состоянию на
  /// позавчера».
  DateTime? get _from {
    if (_period == 'custom') return _customFrom;
    final days = switch (_period) {
      '7d' => 7,
      '30d' => 30,
      '90d' => 90,
      _ => 30,
    };
    return DateTime.now().subtract(Duration(days: days));
  }

  DateTime? get _to => _period == 'custom' ? _customTo : null;

  /// Load audit log entries with current filters
  Future<void> loadEntries({int page = 1}) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final result = await _service.getAuditLog(
        page: page,
        perPage: perPage,
        action: _actionFilter,
        entityType: _entityTypeFilter,
        from: _from,
        to: _to,
      );

      _entries = result.entries;
      _currentPage = result.page;
      _totalPages = result.pages;
      _totalCount = result.total;
      // Журнал отдаётся от новых к старым, поэтому верх первой страницы и
      // есть самая свежая запись выборки.
      if (result.page == 1) {
        _latestAt = result.entries.isEmpty ? null : result.entries.first.createdAt;
      }
      _isLoading = false;
      notifyListeners();
    } catch (e) {
      _isLoading = false;
      _error = _extractMessage(e);
      notifyListeners();
    }
  }

  /// Set action type filter and reload
  void setActionFilter(String? action) {
    _actionFilter = action;
    _resetSelection();
    loadEntries();
  }

  /// Set entity type filter and reload
  void setEntityTypeFilter(String? entityType) {
    _entityTypeFilter = entityType;
    _resetSelection();
    loadEntries();
  }

  /// Сменить период. Для 'custom' границы приходят снаружи, для остальных
  /// считаются от текущего момента при каждом запросе.
  ///
  /// Верхняя граница произвольного периода доводится до конца суток.
  /// `showDateRangePicker` отдаёт последний день полуночью, а бэкенд
  /// сравнивает `created_at <= to`, — и выбравший «01.08 — 25.08» не увидел бы
  /// ничего за 25 августа, то есть ровно за тот день, который обычно и нужен.
  /// Пустая выборка при этом выглядит правдоподобно, и сам себя дефект не
  /// обнаруживает.
  void setPeriod(String period, {DateTime? from, DateTime? to}) {
    _period = period;
    _customFrom = period == 'custom' ? from : null;
    _customTo = period == 'custom' && to != null ? _endOfDay(to) : null;
    _resetSelection();
    loadEntries();
  }

  static DateTime _endOfDay(DateTime day) =>
      DateTime(day.year, day.month, day.day, 23, 59, 59, 999);

  /// Clear all filters and reload
  void clearFilters() {
    _actionFilter = null;
    _entityTypeFilter = null;
    _period = defaultPeriod;
    _customFrom = null;
    _customTo = null;
    _resetSelection();
    loadEntries();
  }

  /// Toggle expanded row for showing details
  void toggleExpanded(String entryId) {
    _expandedEntryId = _expandedEntryId == entryId ? null : entryId;
    notifyListeners();
  }

  /// Смена выборки закрывает раскрытую строку: она принадлежала прежней.
  ///
  /// `latestAt` здесь НЕ обнуляется. Пока новый ответ летит, на экране всё ещё
  /// прежние строки, и подпись шапки описывает именно их — обнулив метку
  /// заранее, мы на пару кадров показали бы прежний счётчик уже без хвоста
  /// «последняя …». Метка меняется вместе с данными, в [loadEntries].
  void _resetSelection() {
    _expandedEntryId = null;
  }

  /// Сброс при смене аккаунта: выборка, фильтры, период и раскрытая строка
  /// принадлежат вошедшему.
  void resetAccountScope() {
    _entries = [];
    _isLoading = false;
    _error = null;
    _currentPage = 1;
    _totalPages = 1;
    _totalCount = 0;
    _latestAt = null;
    _actionFilter = null;
    _entityTypeFilter = null;
    _period = defaultPeriod;
    _customFrom = null;
    _customTo = null;
    _expandedEntryId = null;
    notifyListeners();
  }

  String _extractMessage(Object error) {
    final msg = error.toString();
    if (msg.contains('403')) return 'Доступ запрещён';
    if (msg.contains('401')) return 'Требуется авторизация';
    if (msg.contains('SocketException') || msg.contains('Connection')) {
      return 'Ошибка соединения с сервером';
    }
    return 'Произошла ошибка при загрузке журнала';
  }
}
