import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/services/api_client.dart';

/// Response model for POST /api/v1/search/smart
class SmartSearchResult {
  final SmartSearchIntent? intent;
  final List<Establishment> results;
  final int total;
  final bool fallback;

  /// Пагинация целиком, а не только `total`. Экран результатов листает эту же
  /// выдачу, и без `totalPages`/`hasNext` подгрузка второй страницы не
  /// состоится: список замрёт на первой без единой ошибки. / The results
  /// screen paginates this response — with only `total` it would silently
  /// stop after page one.
  final int page;
  final int limit;
  final int totalPages;
  final bool hasNext;

  SmartSearchResult({
    this.intent,
    required this.results,
    required this.total,
    required this.fallback,
    this.page = 1,
    this.limit = 20,
    this.totalPages = 1,
    this.hasNext = false,
  });

  factory SmartSearchResult.fromJson(Map<String, dynamic> json) {
    final data = json['data'] ?? json;
    final pagination = data['pagination'] as Map<String, dynamic>? ?? const {};
    final total = pagination['total'] as int? ?? 0;
    final limit = pagination['limit'] as int? ?? 20;
    final page = pagination['page'] as int? ?? 1;
    return SmartSearchResult(
      intent: data['intent'] != null
          ? SmartSearchIntent.fromJson(data['intent'] as Map<String, dynamic>)
          : null,
      results: (data['establishments'] as List? ?? [])
          .map((e) => Establishment.fromJson(e as Map<String, dynamic>))
          .toList(),
      total: total,
      fallback: data['fallback'] as bool? ?? true,
      page: page,
      limit: limit,
      // Бэкенд шлёт totalPages; если поле пропало — считаем сами, а не
      // подставляем 1: единица означала бы «страниц больше нет».
      totalPages: pagination['totalPages'] as int? ??
          (limit > 0 ? (total + limit - 1) ~/ limit : 1),
      hasNext: pagination['hasNext'] as bool? ?? (page * limit < total),
    );
  }
}

/// Parsed AI intent from smart search
class SmartSearchIntent {
  final String? category;
  final List<String>? cuisine;

  /// Блюдо из запроса («пицца») — главный смысл запроса по меню, поэтому
  /// идёт первым в заголовке превью / dish named in the query — the primary
  /// intent of a menu-driven query, so it leads the preview header
  final String? dish;
  final String? mealType;
  final double? priceMax;
  final String? location;
  final String? sort;
  final List<String> tags;

  SmartSearchIntent({
    this.category,
    this.cuisine,
    this.dish,
    this.mealType,
    this.priceMax,
    this.location,
    this.sort,
    this.tags = const [],
  });

  factory SmartSearchIntent.fromJson(Map<String, dynamic> json) {
    return SmartSearchIntent(
      category: json['category'] as String?,
      cuisine: (json['cuisine'] as List?)?.map((e) => e.toString()).toList(),
      dish: json['dish'] as String?,
      mealType: json['meal_type'] as String?,
      priceMax: json['price_max'] != null
          ? (json['price_max'] as num).toDouble()
          : null,
      location: json['location'] as String?,
      sort: json['sort'] as String?,
      tags: (json['tags'] as List?)?.map((e) => e.toString()).toList() ?? [],
    );
  }

  /// Build human-readable description of the parsed intent.
  /// Блюдо первым: «пицца · до 20 BYN» / the dish leads: «пицца · до 20 BYN»
  String toDisplayString() {
    final parts = <String>[];
    if (dish != null && dish!.isNotEmpty) parts.add(dish!);
    if (category != null) parts.add(category!);
    if (cuisine != null && cuisine!.isNotEmpty) parts.add(cuisine!.join(', '));
    if (priceMax != null) parts.add('до ${_formatPrice(priceMax!)} BYN');
    if (location != null) parts.add(location!);
    if (sort == 'distance') parts.add('рядом с вами');
    if (sort == 'rating') parts.add('лучшие');
    if (sort == 'price_asc') parts.add('недорого');
    return parts.join(' \u00b7 ');
  }

  /// Целая цена без хвоста «.0» («20», не «20.0»), дробная — как есть («19.5»)
  /// / a whole price drops the ".0" tail, a fractional one prints as-is
  static String _formatPrice(double price) {
    if (price == price.roundToDouble()) return price.round().toString();
    return price.toString();
  }
}

/// Service for smart search API calls
class SmartSearchService {
  final ApiClient _apiClient;

  static final SmartSearchService _instance = SmartSearchService._internal();
  factory SmartSearchService() => _instance;
  SmartSearchService._internal() : _apiClient = ApiClient();

  /// Execute smart search via POST /api/v1/search/smart
  ///
  /// Имена фильтров в теле — те же, что `EstablishmentsService` кладёт в
  /// query-строку классического поиска: бэкенд разбирает оба эндпоинта одним
  /// парсером. Расхождение в написании означало бы, что фильтр молча теряется
  /// ровно тогда, когда строка поиска не пуста. / The body reuses the classic
  /// endpoint's parameter names — the backend parses both with one parser.
  Future<SmartSearchResult> searchSmart({
    required String query,
    double? latitude,
    double? longitude,
    String? city,
    List<String>? categories,
    List<String>? cuisines,
    List<String>? priceRanges,
    double? minRating,
    double? maxDistance,
    String? sortBy,
    String? hoursFilter,
    List<String>? features,
    int limit = 3,
    int page = 1,
  }) async {
    final body = <String, dynamic>{
      'query': query,
      'limit': limit,
      'page': page,
    };

    if (latitude != null) body['latitude'] = latitude;
    if (longitude != null) body['longitude'] = longitude;
    if (city != null) body['city'] = city;
    // Пустой список не отправляем вовсе: на бэкенде он стал бы условием и
    // обнулил выдачу.
    if (categories != null && categories.isNotEmpty) {
      body['categories'] = categories;
    }
    if (cuisines != null && cuisines.isNotEmpty) {
      body['cuisines'] = cuisines;
    }
    if (priceRanges != null && priceRanges.isNotEmpty) {
      body['priceRange'] = priceRanges;
    }
    if (minRating != null) body['min_rating'] = minRating;
    if (maxDistance != null) body['max_distance'] = maxDistance;
    if (sortBy != null) body['sort_by'] = sortBy;
    if (hoursFilter != null) body['hours_filter'] = hoursFilter;
    if (features != null && features.isNotEmpty) {
      body['features'] = features;
    }

    final response = await _apiClient.post(
      '/api/v1/search/smart',
      data: body,
    );

    return SmartSearchResult.fromJson(response.data as Map<String, dynamic>);
  }
}
