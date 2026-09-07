import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:restaurant_guide_mobile/config/cities.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/models/filter_options.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';
import 'package:restaurant_guide_mobile/services/establishments_service.dart';
import 'package:restaurant_guide_mobile/services/location_service.dart';
import 'package:restaurant_guide_mobile/services/smart_search_service.dart';

/// Sort options for establishment list
enum SortOption {
  distance,
  rating,
  priceAsc,
  priceDesc;

  /// Convert to API parameter value
  String toApiValue() {
    switch (this) {
      case SortOption.distance:
        return 'distance';
      case SortOption.rating:
        return 'rating';
      case SortOption.priceAsc:
        return 'price_asc';
      case SortOption.priceDesc:
        return 'price_desc';
    }
  }

  /// Display label in Russian
  String get displayLabel {
    switch (this) {
      case SortOption.distance:
        return 'По расстоянию';
      case SortOption.rating:
        return 'По рейтингу';
      case SortOption.priceAsc:
        return 'По цене ↑';
      case SortOption.priceDesc:
        return 'По цене ↓';
    }
  }
}

/// Establishments state provider
/// Manages search results, filters, and establishment details
class EstablishmentsProvider with ChangeNotifier {
  /// Размер страницы. Задан явно, потому что у двух движков разные
  /// умолчания: у классического поиска 20, у умного 3 (превью на главной).
  /// Без явного значения экран результатов показал бы три карточки.
  static const int _pageSize = 20;

  final EstablishmentsService _service;
  // Синглтон: подменяется в тестах на уровне транспорта ApiClient
  // (test/support/wire_stand.dart), поэтому в конструкторе не нужен.
  final SmartSearchService _smartSearchService = SmartSearchService();
  final LocationService _locationService = LocationService();

  // Search results state
  List<Establishment> _establishments = [];
  PaginationMeta? _paginationMeta;

  /// Разбор фразы и признак отказа AI с последней умной выдачи.
  /// null — искали по фильтрам, строка была пуста.
  SmartSearchIntent? _searchIntent;
  bool _searchFallback = false;
  bool _isLoading = false;
  bool _isLoadingMore = false;
  String? _error;

  // User location (null = no GPS, triggers searchWithoutLocation)
  double? _userLatitude;
  double? _userLongitude;

  // Geolocation banner: show once per session when GPS denied
  bool _hasShownLocationBanner = false;

  // Sort state
  SortOption _currentSort = SortOption.rating;

  /// Трогал ли пользователь контрол сортировки САМ.
  ///
  /// Умному поиску сортировка уходит только если трогал. Иначе значение,
  /// которое пользователь не выбирал (умолчание «по рейтингу» или
  /// автоматический переход на «по расстоянию» после выдачи GPS —
  /// [fetchUserLocation]), считалось бы явным и по правилу слияния
  /// побеждало бы сортировку, выведенную из самой фразы. Тогда «подешевле»
  /// упорядочивало бы превью на главной (оно сортировку не шлёт вовсе) и НЕ
  /// упорядочивало список — три карточки превью перестали бы быть первыми
  /// тремя списка. Ровно то расхождение, ради которого затевалась развилка.
  /// / Only a sort the user actually picked counts as explicit; otherwise a
  /// default the user never chose would silently outrank the sort inferred
  /// from their own phrase, and the preview would stop matching the list.
  bool _sortTouched = false;

  // Current filters (simple)
  String? _selectedCity;
  String? _searchQuery;

  // Advanced filters (Phase 3.2)
  DistanceOption _distanceFilter = DistanceOption.all;
  Set<PriceRange> _priceFilters = {};
  HoursFilter? _hoursFilter;
  Set<String> _categoryFilters = {};
  Set<String> _cuisineFilters = {};
  final Set<String> _amenityFilters = {};

  // Detail view state
  Establishment? _selectedEstablishment;
  bool _isLoadingDetail = false;

  // Favorites state
  Set<String> _favoriteIds = {};
  List<Establishment> _favoriteEstablishments = [];
  bool _isFavoritesLoading = false;
  String? _favoritesError;

  EstablishmentsProvider({EstablishmentsService? service})
      : _service = service ?? EstablishmentsService() {
    AccountScope.register(resetAccountScope);
  }

  /// Favorites belong to the signed-in account — cleared on logout / account
  /// switch. Public catalog/search state deliberately survives (not
  /// account-scoped).
  void resetAccountScope() {
    _favoriteIds = {};
    _favoriteEstablishments = [];
    _isFavoritesLoading = false;
    _favoritesError = null;
    notifyListeners();
  }

  // ============================================================================
  // Getters - Search Results
  // ============================================================================

  /// List of establishments from current search
  List<Establishment> get establishments => _establishments;

  /// Pagination metadata
  PaginationMeta? get paginationMeta => _paginationMeta;

  /// Как умный поиск понял последнюю фразу (null — искали по фильтрам)
  SmartSearchIntent? get searchIntent => _searchIntent;

  /// Последняя выдача собрана в обход AI (он был недоступен)
  bool get searchFallback => _searchFallback;

  /// Whether establishments are being loaded (initial load)
  bool get isLoading => _isLoading;

  /// Whether more establishments are being loaded (pagination)
  bool get isLoadingMore => _isLoadingMore;

  /// Current error message, if any
  String? get error => _error;

  /// Current sort option
  SortOption get currentSort => _currentSort;

  /// Whether there are more pages to load
  bool get hasMorePages {
    if (_paginationMeta == null) return false;
    return _paginationMeta!.page < _paginationMeta!.totalPages;
  }

  /// Current page number
  int get currentPage => _paginationMeta?.page ?? 0;

  /// Total number of results
  int get totalResults => _paginationMeta?.total ?? 0;

  // ============================================================================
  // Getters - Filters
  // ============================================================================

  String? get selectedCity => _selectedCity;
  String? get searchQuery => _searchQuery;

  // Advanced filter getters
  DistanceOption get distanceFilter => _distanceFilter;
  Set<PriceRange> get priceFilters => Set.unmodifiable(_priceFilters);
  HoursFilter? get hoursFilter => _hoursFilter;
  Set<String> get categoryFilters => Set.unmodifiable(_categoryFilters);
  Set<String> get cuisineFilters => Set.unmodifiable(_cuisineFilters);
  Set<String> get amenityFilters => Set.unmodifiable(_amenityFilters);

  // Location getters
  double? get userLatitude => _userLatitude;
  double? get userLongitude => _userLongitude;
  bool get hasRealLocation => _userLatitude != null && _userLongitude != null;

  /// Фильтры экрана одним набором — единственное место, где они
  /// собираются. Ими пользуются и собственный поиск провайдера, и превью
  /// умного поиска на главной; иначе новый фильтр доедет до одного вызова
  /// и потеряется в другом. / The single place the screen's filters are
  /// assembled; both the provider's own search and the home preview read
  /// them from here.
  ScreenFilters get screenFilters {
    // Без GPS сортировка по расстоянию невозможна — откатываемся на рейтинг.
    final effectiveSort =
        (!hasRealLocation && _currentSort == SortOption.distance)
            ? SortOption.rating
            : _currentSort;

    return ScreenFilters(
      city: _selectedCity,
      categories:
          _categoryFilters.isNotEmpty ? _categoryFilters.toList() : null,
      cuisines: _cuisineFilters.isNotEmpty ? _cuisineFilters.toList() : null,
      priceRanges: _priceFilters.isNotEmpty
          ? _priceFilters.map((p) => p.apiValue).toList()
          : null,
      maxDistance:
          hasRealLocation ? _distanceFilter.toMeters()?.toDouble() : null,
      sortBy: effectiveSort.toApiValue(),
      sortTouched: _sortTouched,
      hoursFilter: _hoursFilter?.apiValue,
      features: _amenityFilters.isNotEmpty ? _amenityFilters.toList() : null,
    );
  }

  /// Whether any filters are active
  bool get hasActiveFilters {
    return _selectedCity != null ||
        (_searchQuery != null && _searchQuery!.isNotEmpty) ||
        _distanceFilter != DistanceOption.all ||
        _priceFilters.isNotEmpty ||
        _hoursFilter != null ||
        _categoryFilters.isNotEmpty ||
        _cuisineFilters.isNotEmpty ||
        _amenityFilters.isNotEmpty;
  }

  /// Count of active filter categories (for badge)
  int get activeFilterCount {
    int count = 0;
    if (_distanceFilter != DistanceOption.all) count++;
    if (_priceFilters.isNotEmpty) count++;
    if (_hoursFilter != null) count++;
    if (_categoryFilters.isNotEmpty) count++;
    if (_cuisineFilters.isNotEmpty) count++;
    if (_amenityFilters.isNotEmpty) count++;
    return count;
  }

  // ============================================================================
  // Getters - Detail View
  // ============================================================================

  Establishment? get selectedEstablishment => _selectedEstablishment;
  bool get isLoadingDetail => _isLoadingDetail;

  // ============================================================================
  // Getters - Favorites
  // ============================================================================

  Set<String> get favoriteIds => _favoriteIds;

  /// List of favorite establishments with full data
  List<Establishment> get favoriteEstablishments => _favoriteEstablishments;

  /// Whether favorites are being loaded
  bool get isFavoritesLoading => _isFavoritesLoading;

  /// Error message for favorites loading
  String? get favoritesError => _favoritesError;

  bool isFavorite(dynamic establishmentId) {
    return _favoriteIds.contains(establishmentId.toString());
  }

  // ============================================================================
  // Search Operations
  // ============================================================================

  /// Search establishments with current filters
  Future<void> searchEstablishments({
    int page = 1,
    bool append = false,
  }) async {
    // Развилка движков считается ДО try: её же читает разбор ошибки в catch —
    // текст про лимит запросов честен только для умного пути.
    final queryText = _searchQuery?.trim() ?? '';

    // Don't start new search if already loading
    if (append) {
      if (_isLoadingMore) return;
      _isLoadingMore = true;
    } else {
      if (_isLoading) return;
      _isLoading = true;
      _establishments = [];
    }

    _error = null;
    notifyListeners();

    try {
      // Use real GPS coordinates if available, otherwise null
      // (null triggers searchWithoutLocation on backend)
      final latitude = _userLatitude;
      final longitude = _userLongitude;

      final f = screenFilters;

      // Один движок для текста. Пока в строке есть фраза, выдачу собирает
      // умный поиск: он разбирает её по меню, синонимам и бюджету. Пустая
      // строка — обычный просмотр по фильтрам. Фильтры экрана уходят в обоих
      // случаях, поэтому смена режима не теряет ни одного фильтра. / Text
      // always goes to the smart engine, an empty field to the classic one;
      // the screen's filters travel with both.
      final PaginatedEstablishments result;
      if (queryText.isNotEmpty) {
        final smart = await _smartSearchService.searchSmart(
          query: queryText,
          latitude: latitude,
          longitude: longitude,
          city: f.city,
          categories: f.categories,
          cuisines: f.cuisines,
          priceRanges: f.priceRanges,
          maxDistance: f.maxDistance,
          sortBy: f.explicitSortBy,
          hoursFilter: f.hoursFilter,
          features: f.features,
          page: page,
          limit: _pageSize,
        );
        _searchIntent = smart.intent;
        _searchFallback = smart.fallback;
        result = PaginatedEstablishments(
          data: smart.results,
          meta: PaginationMeta(
            total: smart.total,
            page: smart.page,
            perPage: smart.limit,
            totalPages: smart.totalPages,
          ),
        );
      } else {
        _searchIntent = null;
        _searchFallback = false;
        result = await _service.searchEstablishments(
          page: page,
          perPage: _pageSize,
          city: f.city,
          categories: f.categories,
          cuisines: f.cuisines,
          priceRanges: f.priceRanges,
          latitude: latitude,
          longitude: longitude,
          maxDistance: f.maxDistance,
          search: null,
          // Классике сортировка уходит всегда: выведенной из фразы там нет,
          // спорить не с чем, и порядок обязан совпадать с надписью контрола.
          sortBy: f.sortBy,
          hoursFilter: f.hoursFilter,
          features: f.features,
        );
      }

      if (append) {
        _establishments.addAll(result.data);
        _isLoadingMore = false;
      } else {
        _establishments = result.data;
        _isLoading = false;
      }

      _paginationMeta = result.meta;
      notifyListeners();
    } catch (e) {
      _error = _extractErrorMessage(e, smartPath: queryText.isNotEmpty);
      if (append) {
        _isLoadingMore = false;
      } else {
        _isLoading = false;
      }
      notifyListeners();
    }
  }

  /// Load next page of results
  Future<void> loadMore() async {
    if (!hasMorePages || _isLoading || _isLoadingMore) return;

    await searchEstablishments(
      page: currentPage + 1,
      append: true,
    );
  }

  /// Refresh current search
  Future<void> refresh() async {
    await searchEstablishments(page: 1, append: false);
  }

  /// Set sort option and refresh results
  void setSort(SortOption sort) {
    // Отмечаем выбор ДО сравнения: повторный тап по уже выбранному пункту —
    // тоже осознанный выбор пользователя.
    _sortTouched = true;
    if (_currentSort == sort) return;
    _currentSort = sort;
    notifyListeners();
    // Trigger new search with updated sort
    searchEstablishments(page: 1, append: false);
  }

  // ============================================================================
  // Filter Management
  // ============================================================================

  /// Set user location for distance-based search
  void setUserLocation(double? latitude, double? longitude) {
    _userLatitude = latitude;
    _userLongitude = longitude;
    notifyListeners();
  }

  /// Fetch user's GPS location and update state.
  /// When GPS is granted, switches default sort to distance.
  Future<bool> fetchUserLocation() async {
    final position = await _locationService.getCurrentPosition();
    if (position != null) {
      setUserLocation(position.latitude, position.longitude);
      // Switch to distance sort when GPS becomes available
      // (only if user hasn't manually changed sort)
      if (_currentSort == SortOption.rating) {
        _currentSort = SortOption.distance;
        notifyListeners();
      }
      return true;
    }
    return false;
  }

  /// Set city filter and persist to SharedPreferences
  void setCity(String? city) {
    _selectedCity = city;
    notifyListeners();
    // Persist asynchronously (fire-and-forget)
    if (city != null) {
      SharedPreferences.getInstance().then((prefs) {
        prefs.setString(BelarusCities.persistenceKey, city);
      });
    }
  }

  /// Load persisted city from SharedPreferences.
  /// Returns true if a saved city was found.
  Future<bool> loadPersistedCity() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString(BelarusCities.persistenceKey);
    if (saved != null) {
      _selectedCity = saved;
      notifyListeners();
      return true;
    }
    return false;
  }

  // --- Geolocation banner state ---

  /// Whether the "enable location" banner has been shown this session
  bool get hasShownLocationBanner => _hasShownLocationBanner;

  /// Mark banner as shown for this session
  void markLocationBannerShown() {
    _hasShownLocationBanner = true;
  }

  /// Set search query
  void setSearchQuery(String? query) {
    _searchQuery = query;
    notifyListeners();
  }

  // --- Distance Filter (single selection) ---

  /// Set distance filter
  void setDistanceFilter(DistanceOption option) {
    if (_distanceFilter == option) return;
    _distanceFilter = option;
    notifyListeners();
  }

  // --- Price Range Filter (multi-selection) ---

  /// Toggle price range filter
  void togglePriceFilter(PriceRange range) {
    if (_priceFilters.contains(range)) {
      _priceFilters.remove(range);
    } else {
      _priceFilters.add(range);
    }
    notifyListeners();
  }

  /// Set all price filters at once
  void setPriceFilters(Set<PriceRange> ranges) {
    _priceFilters = Set.from(ranges);
    notifyListeners();
  }

  /// Clear price filters
  void clearPriceFilters() {
    _priceFilters.clear();
    notifyListeners();
  }

  // --- Hours Filter (single selection) ---

  /// Set hours filter
  void setHoursFilter(HoursFilter? filter) {
    _hoursFilter = filter;
    notifyListeners();
  }

  // --- Category Filter (multi-selection) ---

  /// Toggle category filter
  void toggleCategoryFilter(String category) {
    if (_categoryFilters.contains(category)) {
      _categoryFilters.remove(category);
    } else {
      _categoryFilters.add(category);
    }
    notifyListeners();
  }

  /// Set all categories (for "Все" toggle)
  void setAllCategories(bool selectAll) {
    if (selectAll) {
      _categoryFilters = Set.from(FilterConstants.categories);
    } else {
      _categoryFilters.clear();
    }
    notifyListeners();
  }

  /// Check if all categories are selected
  bool get allCategoriesSelected =>
      _categoryFilters.length == FilterConstants.categories.length;

  // --- Cuisine Filter (multi-selection) ---

  /// Toggle cuisine filter
  void toggleCuisineFilter(String cuisine) {
    if (_cuisineFilters.contains(cuisine)) {
      _cuisineFilters.remove(cuisine);
    } else {
      _cuisineFilters.add(cuisine);
    }
    notifyListeners();
  }

  /// Set all cuisines (for "Все" toggle)
  void setAllCuisines(bool selectAll) {
    if (selectAll) {
      _cuisineFilters = Set.from(FilterConstants.cuisines);
    } else {
      _cuisineFilters.clear();
    }
    notifyListeners();
  }

  /// Check if all cuisines are selected
  bool get allCuisinesSelected =>
      _cuisineFilters.length == FilterConstants.cuisines.length;

  // --- Amenity Filter (multi-selection) ---

  /// Toggle amenity filter
  void toggleAmenityFilter(String amenityCode) {
    if (_amenityFilters.contains(amenityCode)) {
      _amenityFilters.remove(amenityCode);
    } else {
      _amenityFilters.add(amenityCode);
    }
    notifyListeners();
  }

  // --- Clear and Apply ---

  /// Clear all filters (reset to defaults)
  void clearFilters() {
    _selectedCity = null;
    _searchQuery = null;
    _distanceFilter = DistanceOption.all;
    _priceFilters.clear();
    _hoursFilter = null;
    _categoryFilters.clear();
    _cuisineFilters.clear();
    _amenityFilters.clear();
    notifyListeners();
  }

  /// Apply filters and search
  Future<void> applyFilters() async {
    await searchEstablishments(page: 1, append: false);
  }

  // ============================================================================
  // Detail View Operations
  // ============================================================================

  /// Load detailed information for specific establishment
  Future<void> loadEstablishmentDetail(String id) async {
    _isLoadingDetail = true;
    _error = null;
    notifyListeners();

    try {
      _selectedEstablishment = await _service.getEstablishmentById(id);
      _isLoadingDetail = false;
      notifyListeners();
    } catch (e) {
      _error = _extractErrorMessage(e);
      _isLoadingDetail = false;
      notifyListeners();
    }
  }

  /// Clear selected establishment
  void clearSelectedEstablishment() {
    _selectedEstablishment = null;
    notifyListeners();
  }

  // ============================================================================
  // Favorites Operations
  // ============================================================================

  /// Toggle favorite status for establishment
  Future<void> toggleFavorite(String establishmentId) async {
    final wasFavorite = _favoriteIds.contains(establishmentId);

    // Store removed establishment for potential revert
    Establishment? removedEstablishment;
    if (wasFavorite) {
      removedEstablishment = _favoriteEstablishments
          .where((e) => e.id == establishmentId)
          .firstOrNull;
    }

    // Optimistic update
    if (wasFavorite) {
      _favoriteIds.remove(establishmentId);
      _removeFromFavoritesList(establishmentId);
    } else {
      _favoriteIds.add(establishmentId);
      _addToFavoritesList(establishmentId);
    }
    notifyListeners();

    try {
      if (wasFavorite) {
        await _service.removeFromFavorites(establishmentId);
      } else {
        await _service.addToFavorites(establishmentId);
      }
    } catch (e) {
      // Revert on error
      if (wasFavorite) {
        _favoriteIds.add(establishmentId);
        // Restore removed establishment to list
        if (removedEstablishment != null) {
          _favoriteEstablishments.add(removedEstablishment);
        }
      } else {
        _favoriteIds.remove(establishmentId);
      }
      notifyListeners();

      // Show error but don't throw
      _error = 'Failed to update favorites';
      notifyListeners();
    }
  }

  /// Load favorites from server
  Future<void> loadFavorites() async {
    _isFavoritesLoading = true;
    _favoritesError = null;
    notifyListeners();

    try {
      final favorites = await _service.getFavorites();
      _favoriteEstablishments = favorites;
      _favoriteIds = favorites.map((e) => e.id).toSet();
      _isFavoritesLoading = false;
      notifyListeners();
    } catch (e) {
      _favoritesError = _extractErrorMessage(e);
      _isFavoritesLoading = false;
      notifyListeners();
    }
  }

  /// Refresh favorites list (for pull-to-refresh)
  Future<void> refreshFavorites() async {
    await loadFavorites();
  }

  /// Add establishment to favorites list (optimistic update)
  void _addToFavoritesList(String establishmentId) {
    // Avoid duplicates
    if (_favoriteEstablishments.any((e) => e.id == establishmentId)) return;

    // Try to find establishment in current search results or selected detail
    final est = _establishments.where((e) => e.id == establishmentId).firstOrNull ??
        (_selectedEstablishment?.id == establishmentId ? _selectedEstablishment : null);
    if (est != null) {
      _favoriteEstablishments.add(est);
    }
  }

  /// Remove establishment from favorites list (optimistic update)
  void _removeFromFavoritesList(String establishmentId) {
    _favoriteEstablishments.removeWhere((e) => e.id == establishmentId);
    notifyListeners();
  }

  /// Clear favorites error
  void clearFavoritesError() {
    _favoritesError = null;
    notifyListeners();
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /// Clear error message
  void clearError() {
    _error = null;
    notifyListeners();
  }

  /// Extract user-friendly error message
  String _extractErrorMessage(Object error, {bool smartPath = false}) {
    final errorStr = error.toString();

    if (errorStr.contains('Network') || errorStr.contains('Connection')) {
      return 'Network error. Please check your internet connection.';
    }
    // Код статуса берём у самого исключения, а не из его текста: `ApiClient`
    // пересобирает DioException без `message`, и в `toString()` попадают лишь
    // тип и подставленный текст — числа 429 там нет вовсе. Проверки по строке
    // ниже оставлены для ошибок, прилетающих не от Dio. / The status code is
    // read from the exception, not from its text: the rebuilt DioException
    // prints no status code at all.
    if (error is DioException && error.response?.statusCode == 429) {
      // Умный поиск ограничен 30 запросами в минуту на IP: за ним стоит вызов
      // внешней модели. Общий текст «попробуйте позже» здесь врёт — ждать надо
      // именно минуту, и повтор сразу упрётся в тот же лимит. На остальных
      // путях действует глобальный часовой лимит, и совет «минуту» врал бы
      // уже в другую сторону — поэтому срок называем только там, где знаем.
      return smartPath
          ? 'Слишком много запросов, подождите минуту'
          : 'Слишком много запросов. Попробуйте позже.';
    }
    if (errorStr.contains('404')) {
      return 'Establishment not found.';
    }
    if (errorStr.contains('500')) {
      return 'Server error. Please try again later.';
    }

    return 'An error occurred. Please try again.';
  }
}
