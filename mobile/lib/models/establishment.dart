import 'package:restaurant_guide_mobile/models/promotion.dart';

/// English→Russian mapping for cuisine values (legacy/test data compatibility)
const _cuisineToRussian = {
  'belarusian': 'Народная',
  'national': 'Народная',
  'author': 'Авторская',
  'fusion': 'Авторская',
  'asian': 'Азиатская',
  'american': 'Американская',
  'vegetarian': 'Вегетарианская',
  'japanese': 'Японская',
  'georgian': 'Грузинская',
  'italian': 'Итальянская',
  'mixed': 'Смешанная',
  'international': 'Смешанная',
  'continental': 'Европейская',
  'european': 'Европейская',
  'chinese': 'Китайская',
  'eastern': 'Восточная',
};

/// English→Russian mapping for category values (legacy/test data compatibility)
const _categoryToRussian = {
  'restaurant': 'Ресторан',
  'cafe': 'Кофейня',
  'cafe_dining': 'Кафе',
  'fast_food': 'Фаст-фуд',
  'pizzeria': 'Пиццерия',
  'bar': 'Бар',
  'pub': 'Паб',
  'bakery': 'Пекарня',
  'confectionery': 'Кондитерская',
  'karaoke': 'Караоке',
  'canteen': 'Столовая',
  'hookah_bar': 'Кальянная',
  'hookah_lounge': 'Кальянная',
  'bowling': 'Боулинг',
  'billiards': 'Бильярд',
  'nightclub': 'Клуб',
};

/// Normalize a value to Russian — if already Russian, returns as-is
String _toRussian(String value, Map<String, String> mapping) {
  return mapping[value.toLowerCase()] ?? value;
}

/// Establishment model representing a restaurant/cafe
/// Matches backend API response format
class Establishment {
  final String id;  // UUID from backend (String for new API, kept for compatibility)
  final String name;
  final String? description;
  final String category;  // Primary category (first from categories array)
  final List<String>? categories;  // All categories
  final String? cuisine;  // Primary cuisine (first from cuisines array)
  final List<String>? cuisines;  // All cuisines
  final String? priceRange;
  final double? rating;
  final String address;
  final String city;
  final double? latitude;
  final double? longitude;
  final Map<String, dynamic>? workingHours;
  final String? phone;
  final String? website;
  final Map<String, dynamic>? attributes;
  final String status;
  final List<EstablishmentMedia>? media;
  final String? thumbnailUrl;
  final double? distance; // Distance from user in km (from API or calculated)
  final bool hasPromotion; // From search enrichment
  final int promotionCount; // From search enrichment
  final bool bookingEnabled; // From establishments.booking_enabled
  final List<Promotion>? promotions; // From detail endpoint
  final DateTime createdAt;
  final DateTime updatedAt;

  Establishment({
    required this.id,
    required this.name,
    this.description,
    required this.category,
    this.categories,
    this.cuisine,
    this.cuisines,
    this.priceRange,
    this.rating,
    required this.address,
    required this.city,
    this.latitude,
    this.longitude,
    this.workingHours,
    this.phone,
    this.website,
    this.attributes,
    required this.status,
    this.media,
    this.thumbnailUrl,
    this.distance,
    this.hasPromotion = false,
    this.promotionCount = 0,
    this.bookingEnabled = false,
    this.promotions,
    required this.createdAt,
    required this.updatedAt,
  });

  /// Create from JSON
  factory Establishment.fromJson(Map<String, dynamic> json) {
    // Parse categories array and normalize to Russian
    final categoriesList = json['categories'] != null
        ? (json['categories'] as List)
            .map((e) => _toRussian(e.toString(), _categoryToRussian))
            .toList()
        : <String>[];

    // Parse cuisines array and normalize to Russian
    final cuisinesList = json['cuisines'] != null
        ? (json['cuisines'] as List)
            .map((e) => _toRussian(e.toString(), _cuisineToRussian))
            .toList()
        : <String>[];

    return Establishment(
      id: json['id'].toString(),  // UUID as String
      name: json['name'] as String,
      description: json['description'] as String?,
      category: categoriesList.isNotEmpty ? categoriesList.first : 'Ресторан',
      categories: categoriesList,
      cuisine: cuisinesList.isNotEmpty ? cuisinesList.first : null,
      cuisines: cuisinesList,
      priceRange: json['price_range'] as String?,
      rating: json['average_rating'] != null
          ? double.tryParse(json['average_rating'].toString())
          : (json['rating'] != null ? (json['rating'] as num).toDouble() : null),
      address: json['address'] as String,
      city: json['city'] as String,
      latitude: json['latitude'] != null
          ? (json['latitude'] as num).toDouble()
          : null,
      longitude: json['longitude'] != null
          ? (json['longitude'] as num).toDouble()
          : null,
      workingHours: json['working_hours'] as Map<String, dynamic>?,
      phone: json['phone'] as String?,
      website: json['website'] as String?,
      attributes: json['attributes'] as Map<String, dynamic>?,
      status: json['status'] as String,
      media: json['media'] != null
          ? (json['media'] as List)
              .map((m) => EstablishmentMedia.fromJson(m as Map<String, dynamic>))
              .toList()
          : null,
      thumbnailUrl: json['thumbnail_url'] ?? json['primary_image_url'] as String?,
      distance: _parseDoubleSafe(json['distance']),
      hasPromotion: json['has_promotion'] == true,
      bookingEnabled: json['booking_enabled'] == true,
      promotionCount: json['promotion_count'] as int? ?? 0,
      promotions: json['promotions'] != null
          ? (json['promotions'] as List)
              .map((p) => Promotion.fromJson(p as Map<String, dynamic>))
              .toList()
          : null,
      createdAt: DateTime.parse(json['created_at'] as String),
      updatedAt: DateTime.parse(json['updated_at'] as String),
    );
  }

  /// Safe double parsing for API values
  static double? _parseDoubleSafe(dynamic value) {
    if (value == null) return null;
    if (value is double) return value;
    if (value is num) return value.toDouble();
    if (value is String) return double.tryParse(value);
    return null;
  }

  /// Convert to JSON
  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'description': description,
      'category': category,
      'cuisine': cuisine,
      'price_range': priceRange,
      'rating': rating,
      'address': address,
      'city': city,
      'latitude': latitude,
      'longitude': longitude,
      'working_hours': workingHours,
      'phone': phone,
      'website': website,
      'attributes': attributes,
      'status': status,
      'media': media?.map((m) => m.toJson()).toList(),
      'thumbnail_url': thumbnailUrl,
      'created_at': createdAt.toIso8601String(),
      'updated_at': updatedAt.toIso8601String(),
    };
  }

  // Day key constants for working hours lookup
  static const _dayKeys = [
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'
  ];

  /// Parse day hours from two possible formats:
  /// String: "10:00-22:00" → {'open': '10:00', 'close': '22:00', 'is_open': true}
  /// Object: {"open": "10:00", "close": "22:00"} → same
  /// Object closed: {"is_open": false} → {'is_open': false}
  static Map<String, dynamic>? parseDayHours(dynamic dayHours) {
    if (dayHours == null) return null;

    if (dayHours is String) {
      final parts = dayHours.split('-');
      if (parts.length == 2) {
        return {'open': parts[0].trim(), 'close': parts[1].trim(), 'is_open': true};
      }
      return null;
    } else if (dayHours is Map) {
      if (dayHours['is_open'] == false) {
        return {'is_open': false};
      }
      return {
        'open': dayHours['open'] as String?,
        'close': dayHours['close'] as String?,
        'is_open': true,
      };
    }
    return null;
  }

  /// Часы работы на КОНКРЕТНЫЙ момент — чистая функция от [moment].
  ///
  /// Вынесено из `todayHours` ради проверяемости: пока единственным
  /// источником времени был `DateTime.now()`, ветку «через полночь» нельзя
  /// было проверить иначе как подгонкой ожидания под часы машины, а это
  /// вычисляемое ожидание и флейк на границе суток.
  Map<String, dynamic>? hoursAt(DateTime moment) {
    if (workingHours == null) return null;
    final dayKey = _dayKeys[moment.weekday - 1];
    return parseDayHours(workingHours![dayKey]);
  }

  /// Get today's parsed working hours
  Map<String, dynamic>? get todayHours => hoursAt(DateTime.now());

  /// Открыто ли заведение в КОНКРЕТНЫЙ момент.
  ///
  /// Момент один на весь расчёт — и для выбора дня недели, и для минут.
  /// Прежняя версия звала `DateTime.now()` дважды (через `todayHours` и
  /// отдельно), поэтому ровно в полночь могла взять день до перехода, а
  /// минуты после.
  bool isOpenAt(DateTime moment) {
    final hours = hoursAt(moment);
    if (hours == null) return status == 'active'; // fallback if no hours data
    if (hours['is_open'] == false) return false;

    final openStr = hours['open'] as String?;
    final closeStr = hours['close'] as String?;
    if (openStr == null || closeStr == null) return status == 'active';

    final currentMinutes = moment.hour * 60 + moment.minute;

    final openParts = openStr.split(':');
    final closeParts = closeStr.split(':');
    final openMinutes = int.parse(openParts[0]) * 60 + int.parse(openParts[1]);
    final closeMinutes = int.parse(closeParts[0]) * 60 + int.parse(closeParts[1]);

    // Handle overnight case (e.g., open=18:00, close=02:00)
    if (closeMinutes <= openMinutes) {
      return currentMinutes >= openMinutes || currentMinutes < closeMinutes;
    }
    return currentMinutes >= openMinutes && currentMinutes < closeMinutes;
  }

  /// Check if establishment is currently open based on working hours
  bool get isCurrentlyOpen => isOpenAt(DateTime.now());

  /// Время закрытия на конкретный момент; `null`, если день выходной или
  /// часов нет.
  String? closingTimeAt(DateTime moment) {
    final hours = hoursAt(moment);
    if (hours == null) return null;
    if (hours['is_open'] == false) return null;
    return hours['close'] as String?;
  }

  /// Get today's closing time string
  String? get todayClosingTime => closingTimeAt(DateTime.now());

  /// Copy with modifications
  Establishment copyWith({
    String? id,
    String? name,
    String? description,
    String? category,
    List<String>? categories,
    String? cuisine,
    List<String>? cuisines,
    String? priceRange,
    double? rating,
    String? address,
    String? city,
    double? latitude,
    double? longitude,
    Map<String, dynamic>? workingHours,
    String? phone,
    String? website,
    Map<String, dynamic>? attributes,
    String? status,
    List<EstablishmentMedia>? media,
    String? thumbnailUrl,
    double? distance,
    DateTime? createdAt,
    DateTime? updatedAt,
  }) {
    return Establishment(
      id: id ?? this.id,
      name: name ?? this.name,
      description: description ?? this.description,
      category: category ?? this.category,
      categories: categories ?? this.categories,
      cuisine: cuisine ?? this.cuisine,
      cuisines: cuisines ?? this.cuisines,
      priceRange: priceRange ?? this.priceRange,
      rating: rating ?? this.rating,
      address: address ?? this.address,
      city: city ?? this.city,
      latitude: latitude ?? this.latitude,
      longitude: longitude ?? this.longitude,
      workingHours: workingHours ?? this.workingHours,
      phone: phone ?? this.phone,
      website: website ?? this.website,
      attributes: attributes ?? this.attributes,
      status: status ?? this.status,
      media: media ?? this.media,
      thumbnailUrl: thumbnailUrl ?? this.thumbnailUrl,
      distance: distance ?? this.distance,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }
}

/// Media associated with an establishment
class EstablishmentMedia {
  final String id;  // UUID from backend
  final String establishmentId;
  final String type;
  final String fileType; // 'image' | 'pdf' — defaults to 'image' for legacy rows
  final String? thumbnailUrl;
  final String? previewUrl;
  final String? url;
  final String? caption;
  final int position;
  final DateTime createdAt;

  EstablishmentMedia({
    required this.id,
    required this.establishmentId,
    required this.type,
    this.fileType = 'image',
    this.thumbnailUrl,
    this.previewUrl,
    this.url,
    this.caption,
    required this.position,
    required this.createdAt,
  });

  bool get isPdf => fileType == 'pdf';

  factory EstablishmentMedia.fromJson(Map<String, dynamic> json) {
    return EstablishmentMedia(
      id: json['id'].toString(),  // UUID as String
      establishmentId: json['establishment_id'].toString(),
      type: json['type'] as String,
      fileType: json['file_type'] as String? ?? 'image',
      thumbnailUrl: json['thumbnail_url'] as String?,
      previewUrl: json['preview_url'] as String?,
      url: json['url'] as String?,
      caption: json['caption'] as String?,
      position: json['position'] as int,
      createdAt: DateTime.parse(json['created_at'] as String),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'establishment_id': establishmentId,
      'type': type,
      'file_type': fileType,
      'thumbnail_url': thumbnailUrl,
      'preview_url': previewUrl,
      'url': url,
      'caption': caption,
      'position': position,
      'created_at': createdAt.toIso8601String(),
    };
  }
}

/// Paginated response for establishment lists
class PaginatedEstablishments {
  final List<Establishment> data;
  final PaginationMeta meta;

  PaginatedEstablishments({
    required this.data,
    required this.meta,
  });

  factory PaginatedEstablishments.fromJson(Map<String, dynamic> json) {
    return PaginatedEstablishments(
      data: (json['data'] as List)
          .map((e) => Establishment.fromJson(e as Map<String, dynamic>))
          .toList(),
      meta: PaginationMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );
  }
}

/// Pagination metadata
class PaginationMeta {
  final int total;
  final int page;
  final int perPage;
  final int totalPages;

  PaginationMeta({
    required this.total,
    required this.page,
    required this.perPage,
    required this.totalPages,
  });

  factory PaginationMeta.fromJson(Map<String, dynamic> json) {
    return PaginationMeta(
      total: json['total'] as int,
      page: json['page'] as int,
      perPage: json['per_page'] as int,
      totalPages: json['total_pages'] as int,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'total': total,
      'page': page,
      'per_page': perPage,
      'total_pages': totalPages,
    };
  }
}
