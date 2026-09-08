import 'package:flutter/foundation.dart';
import 'package:restaurant_guide_admin_web/models/flagged_menu_item.dart';
import 'package:restaurant_guide_admin_web/services/account_scope.dart';
import 'package:restaurant_guide_admin_web/services/admin_menu_item_service.dart';

/// Область очереди по признаку скрытости.
///
/// Это НЕ статус заведения: «Активные» здесь значит «не скрытые модератором»,
/// а заведение при этом может быть и на модерации, и приостановлено. Фильтр
/// на экране называется «Видимость» именно поэтому — прежнее «Статус» путало
/// две разные оси.
enum MenuItemVisibility { all, visible, hidden }

extension MenuItemVisibilityWire on MenuItemVisibility {
  /// Значение для сервера. Совпадает с `VISIBILITY_MODES` (menuItemModel.js):
  /// неизвестный режим там отвергается, а не подменяется молча.
  String get wire => switch (this) {
        MenuItemVisibility.all => 'all',
        MenuItemVisibility.visible => 'visible',
        MenuItemVisibility.hidden => 'hidden',
      };
}

/// Состояние экрана «Позиции меню».
///
/// **Все фильтры серверные.** Очередь листается, и отбор поверх одной
/// страницы отвечал бы не на тот вопрос, который показывает: «Гродно»
/// отфильтровало бы страницу, а подпись говорила бы про очередь.
///
/// Снимок загруженного окна (`loadedTotal`, `loadedVisibility` и прочие)
/// держится отдельно от выставленных фильтров: подпись экрана обязана
/// описывать ТО, ЧТО НА ЭКРАНЕ. Если обновление не прошло, список остаётся
/// прежним, и подпись вместе с ним — о сбое сообщает тост.
class MenuItemsModerationProvider with ChangeNotifier {
  final AdminMenuItemService _service;

  static const int perPage = 20;

  MenuItemsModerationProvider({AdminMenuItemService? service})
      : _service = service ?? AdminMenuItemService() {
    AccountScope.register(resetAccountScope);
  }

  List<FlaggedMenuItem> _items = <FlaggedMenuItem>[];
  String? _selectedId;

  bool _isLoading = false;
  bool _hasLoaded = false;
  String? _error;

  /// Номер поколения запроса: ответ, обогнанный более поздним, свой результат
  /// не пишет. Модератор успевает нажать город и сразу страницу.
  int _requestSeq = 0;

  // ── Выставленные фильтры ────────────────────────────────────────────────
  //
  // Умолчание — нескрытые: бейдж рейла считает их же, и клик по «12» обязан
  // открыть двенадцать строк. В кадре 03 пилюля «Активные» тоже выбрана.
  MenuItemVisibility _visibility = MenuItemVisibility.visible;
  String? _city;
  String? _reason;
  String _search = '';

  // ── Снимок загруженного окна ────────────────────────────────────────────
  int _page = 1;
  int _loadedPerPage = perPage;

  /// Страница ПОСЛЕДНЕГО запроса — не обязательно загруженная: запрос мог
  /// упасть. Повтор идёт по ней.
  int _requestedPage = 1;
  int _pages = 1;
  int _loadedTotal = 0;
  int? _loadedVisibleCount;
  int? _loadedHiddenCount;
  MenuItemVisibility _loadedVisibility = MenuItemVisibility.visible;
  bool _loadedNarrowed = false;
  List<String> _cities = const <String>[];
  List<String> _reasons = const <String>[];

  bool _isSubmittingAction = false;
  String? _actionError;

  // ============================================================================
  // Getters
  // ============================================================================

  List<FlaggedMenuItem> get items => _items;
  FlaggedMenuItem? get selected =>
      _items.where((i) => i.id == _selectedId).firstOrNull;
  String? get selectedId => _selectedId;

  bool get isLoading => _isLoading;

  /// Первая загрузка — под скелетоном; последующие — полосой в шапке поверх
  /// прежних данных. Подменять список скелетоном на обновлении нельзя: это
  /// стирает то, что модератор читает.
  ///
  /// Состояние «ещё не спрашивали» тоже считается первой загрузкой: запрос
  /// уходит после первого кадра, и на этом кадре пустой список рисовал бы
  /// успокоительное «Очередь разобрана» — утверждение о том, чего никто ещё
  /// не проверял.
  bool get isFirstLoad => !_hasLoaded && _error == null;
  bool get isRefreshing => _isLoading && _hasLoaded;
  bool get hasLoaded => _hasLoaded;
  String? get error => _error;

  MenuItemVisibility get visibility => _visibility;
  String? get cityFilter => _city;
  String? get reasonFilter => _reason;
  String get searchFilter => _search;

  /// Сужен ли отбор чем-то, кроме области видимости.
  bool get hasNarrowingFilters =>
      (_city != null && _city!.isNotEmpty) ||
      (_reason != null && _reason!.isNotEmpty) ||
      _search.trim().isNotEmpty;

  int get page => _page;
  int get pages => _pages;

  /// Размер страницы из ОТВЕТА: сервер зажимает запрошенный своим потолком,
  /// и футер обязан считать диапазон по тому, что реально приехало.
  int get loadedPerPage => _loadedPerPage;
  int get loadedTotal => _loadedTotal;
  int? get loadedVisibleCount => _loadedVisibleCount;
  int? get loadedHiddenCount => _loadedHiddenCount;
  MenuItemVisibility get loadedVisibility => _loadedVisibility;
  bool get loadedNarrowed => _loadedNarrowed;

  List<String> get availableCities => _cities;
  List<String> get availableReasons => _reasons;

  bool get isSubmittingAction => _isSubmittingAction;
  String? get actionError => _actionError;

  // ============================================================================
  // Account scope
  // ============================================================================

  /// Сброс при смене аккаунта: очередь, выбор, фильтры и снимок окна
  /// принадлежат вошедшему. Поколение сдвигается, чтобы летящий ответ был
  /// выброшен; `_hasLoaded` снимается, чтобы следующий вход начался со
  /// скелетона, а не с утверждения «очередь разобрана».
  void resetAccountScope() {
    _requestSeq++;
    _items = <FlaggedMenuItem>[];
    _selectedId = null;
    _isLoading = false;
    _hasLoaded = false;
    _error = null;
    _visibility = MenuItemVisibility.visible;
    _city = null;
    _reason = null;
    _search = '';
    _page = 1;
    _loadedPerPage = perPage;
    _requestedPage = 1;
    _pages = 1;
    _loadedTotal = 0;
    _loadedVisibleCount = null;
    _loadedHiddenCount = null;
    _loadedVisibility = MenuItemVisibility.visible;
    _loadedNarrowed = false;
    _cities = const <String>[];
    _reasons = const <String>[];
    _isSubmittingAction = false;
    _actionError = null;
    notifyListeners();
  }

  // ============================================================================
  // Load
  // ============================================================================

  /// Загрузка страницы.
  ///
  /// [allowRewind] защищает от единственного рекурсивного шага: страница за
  /// пределами выборки перечитывается один раз и не может зациклиться.
  Future<void> loadFlaggedItems({int? page, bool allowRewind = true}) async {
    final requestedPage = page ?? _page;
    _requestedPage = requestedPage;
    final seq = ++_requestSeq;

    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final response = await _service.getFlaggedItems(
        page: requestedPage,
        perPage: perPage,
        reason: _reason,
        visibility: _visibility.wire,
        city: _city,
        search: _search,
      );

      if (seq != _requestSeq) return;

      _items = response.items;
      _page = response.page;
      _pages = response.pages;
      _loadedPerPage = response.perPage;
      _loadedTotal = response.total;
      _loadedVisibleCount = response.visibleCount;
      _loadedHiddenCount = response.hiddenCount;
      _loadedVisibility = _visibility;
      _loadedNarrowed = hasNarrowingFilters;
      _cities = response.cities;
      // Канон причин приходит с каждой страницей и не зависит от выборки.
      // Пустым он не бывает — но если сервер промолчал, прежний список лучше
      // пустого фильтра.
      if (response.reasons.isNotEmpty) _reasons = response.reasons;

      // Выбор переопределяется по свежему списку: позиция могла уехать из
      // выборки (сняли флаг, скрыли при отборе «Активные»), и панель разбора
      // не должна показывать то, чего в очереди уже нет.
      if (_selectedId != null && !_items.any((i) => i.id == _selectedId)) {
        _selectedId = null;
      }

      _hasLoaded = true;
      _isLoading = false;
      notifyListeners();

      // Страница за пределами выборки — тупик, из которого экран сам не
      // выбирается: тело показывает «очередь разобрана», футер не рисуется
      // (строк нет), и ни один контрол не возвращает на первую страницу.
      // Попасть туда просто: провайдер живёт на уровне приложения, номер
      // страницы переживает уход с экрана, а очередь тем временем убывает.
      if (allowRewind && _items.isEmpty && _loadedTotal > 0 && _page > 1) {
        final lastPage = _pages < 1 ? 1 : _pages;
        if (lastPage != _page) {
          await loadFlaggedItems(page: lastPage, allowRewind: false);
        }
      }
    } catch (e) {
      if (seq != _requestSeq) return;
      _isLoading = false;
      _error = 'Не удалось загрузить список позиций';
      notifyListeners();
    }
  }

  /// Повтор ПОСЛЕДНЕГО запроса, а не последней удачи.
  ///
  /// Переход на четвёртую страницу упал, модератор жмёт «Ещё раз» в тосте —
  /// он просит четвёртую, а не ту третью, на которой остался экран. Иначе
  /// намерение теряется молча.
  Future<void> refresh() => loadFlaggedItems(page: _requestedPage);

  Future<void> goToPage(int page) {
    if (page < 1 || page == _page) return Future<void>.value();
    return loadFlaggedItems(page: page);
  }

  // ============================================================================
  // Selection
  // ============================================================================

  void selectItem(String id) {
    if (_selectedId == id) return;
    _selectedId = id;
    _actionError = null;
    notifyListeners();
  }

  void clearSelection() {
    _selectedId = null;
    notifyListeners();
  }

  // ============================================================================
  // Filters — каждый сбрасывает страницу и перечитывает выборку
  // ============================================================================

  Future<void> setVisibility(MenuItemVisibility value) {
    if (_visibility == value) return Future<void>.value();
    _visibility = value;
    notifyListeners();
    return loadFlaggedItems(page: 1);
  }

  Future<void> setCityFilter(String? city) {
    final next = (city == null || city.isEmpty) ? null : city;
    if (_city == next) return Future<void>.value();
    _city = next;
    notifyListeners();
    return loadFlaggedItems(page: 1);
  }

  Future<void> setReasonFilter(String? reason) {
    final next = (reason == null || reason.isEmpty) ? null : reason;
    if (_reason == next) return Future<void>.value();
    _reason = next;
    notifyListeners();
    return loadFlaggedItems(page: 1);
  }

  Future<void> setSearchFilter(String query) {
    if (_search == query) return Future<void>.value();
    _search = query;
    notifyListeners();
    return loadFlaggedItems(page: 1);
  }

  /// Сброс всего, кроме области видимости: её модератор выбирал отдельно и
  /// вкладку под ним менять не следует.
  ///
  /// Условие смотрит и на снимок: если сброс уже обнулил фильтры, а перечитка
  /// упала, на экране осталось «Ничего не нашлось» с этой самой кнопкой — и
  /// повторное нажатие обязано повторить запрос, а не выйти молча. Кнопка,
  /// не реагирующая на нажатие, читается как поломка.
  Future<void> resetNarrowingFilters() {
    if (!hasNarrowingFilters && !_loadedNarrowed) return Future<void>.value();
    _city = null;
    _reason = null;
    _search = '';
    notifyListeners();
    return loadFlaggedItems(page: 1);
  }

  // ============================================================================
  // Actions
  // ============================================================================

  Future<bool> hideItem(String menuItemId, String reason) {
    return _runAction(
      () => _service.hideItem(menuItemId: menuItemId, reason: reason),
      failure: 'Позиция не скрыта',
    );
  }

  Future<bool> unhideItem(String menuItemId) {
    return _runAction(
      () => _service.unhideItem(menuItemId),
      failure: 'Позиция не показана',
    );
  }

  Future<bool> dismissFlag(String menuItemId) {
    return _runAction(
      () => _service.dismissFlag(menuItemId),
      failure: 'Флаг не снят',
    );
  }

  /// Действие + перечитка страницы.
  ///
  /// Правка строки на месте больше не годится: скрытие меняет и членство в
  /// выборке (при отборе «Активные» позиция из неё уходит), и оба счётчика
  /// подписи, и число страниц. Считает это сервер, и спрашивать надо его.
  Future<bool> _runAction(
    Future<Map<String, dynamic>> Function() action, {
    required String failure,
  }) async {
    _isSubmittingAction = true;
    _actionError = null;
    notifyListeners();

    try {
      await action();
      _isSubmittingAction = false;
      // Перечитка сама уведёт с опустевшей страницы: последняя позиция могла
      // уйти из выборки, и страница осталась бы существующей, но пустой.
      await loadFlaggedItems();
      return true;
    } catch (e) {
      // Сообщение называет ДЕЙСТВИЕ: тост показывает экран, и «не удалось
      // выполнить действие» не сказало бы модератору, какое именно.
      _actionError = failure;
      _isSubmittingAction = false;
      notifyListeners();
      return false;
    }
  }
}
