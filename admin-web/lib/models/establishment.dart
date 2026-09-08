/// Data models for establishment moderation workflow
library;

import 'dart:convert' show jsonDecode;

/// Lightweight model for the pending list card
class EstablishmentListItem {
  final String id;
  final String name;
  final String? city;
  final List<String> categories;
  final List<String> cuisines;
  final String? phone;
  final String? email;
  final String? thumbnailUrl;
  final DateTime? updatedAt;
  final DateTime? createdAt;

  const EstablishmentListItem({
    required this.id,
    required this.name,
    this.city,
    this.categories = const [],
    this.cuisines = const [],
    this.phone,
    this.email,
    this.thumbnailUrl,
    this.updatedAt,
    this.createdAt,
  });

  factory EstablishmentListItem.fromJson(Map<String, dynamic> json) {
    final photo = json['primary_photo'];
    String? thumbnail;
    if (photo is Map<String, dynamic>) {
      thumbnail = photo['thumbnail_url'] as String? ?? photo['url'] as String?;
    }

    return EstablishmentListItem(
      id: json['id'] as String,
      name: json['name'] as String? ?? '',
      city: json['city'] as String?,
      categories: _parseStringList(json['categories']),
      cuisines: _parseStringList(json['cuisines']),
      phone: json['phone'] as String?,
      email: json['email'] as String?,
      thumbnailUrl: thumbnail,
      updatedAt: _parseDate(json['updated_at']),
      createdAt: _parseDate(json['created_at']),
    );
  }
}

/// Full model for the moderation detail panel
class EstablishmentDetail {
  // Core
  final String id;
  final String partnerId;
  final String name;
  final String? description;
  final String status;

  // Address tab
  final String? city;
  final String? address;
  final double? latitude;
  final double? longitude;

  // About tab
  final String? phone;
  final String? email;
  final String? website;
  final List<String> categories;
  final List<String> cuisines;
  final String? priceRange;
  final Map<String, dynamic>? workingHours;
  final Map<String, dynamic>? specialHours;
  final Map<String, dynamic>? attributes;

  // Data tab (legal / partner info)
  final String? legalName;
  final String? unp;
  final String? registrationDocUrl;
  final String? contactPerson;
  final String? contactEmail;

  // Media tab
  final List<MediaItem> interiorPhotos;
  final List<MediaItem> menuMedia;

  // Moderation metadata
  final Map<String, dynamic>? moderationNotes;

  /// Кто приостановил — из журнала действий (`suspended_by`), а не из
  /// `moderation_notes`: там автора нет по построению. `null` — заведение
  /// не приостановлено или приостановка старше журнала.
  final String? suspendedByName;
  final DateTime? suspendedByAt;

  /// Сервер скрыл контакты партнёра и документ: вошедший — просмотрщик.
  /// Пустые `contactPerson` / `contactEmail` / `registrationDocUrl` при этом
  /// значат «скрыто», а не «не заполнено».
  final bool partnerDataRedacted;

  // Timestamps
  final DateTime? createdAt;
  final DateTime? updatedAt;

  const EstablishmentDetail({
    required this.id,
    required this.partnerId,
    required this.name,
    this.description,
    required this.status,
    this.city,
    this.address,
    this.latitude,
    this.longitude,
    this.phone,
    this.email,
    this.website,
    this.categories = const [],
    this.cuisines = const [],
    this.priceRange,
    this.workingHours,
    this.specialHours,
    this.attributes,
    this.legalName,
    this.unp,
    this.registrationDocUrl,
    this.contactPerson,
    this.contactEmail,
    this.interiorPhotos = const [],
    this.menuMedia = const [],
    this.moderationNotes,
    this.suspendedByName,
    this.suspendedByAt,
    this.partnerDataRedacted = false,
    this.createdAt,
    this.updatedAt,
  });

  factory EstablishmentDetail.fromJson(Map<String, dynamic> json) {
    final suspendedBy = _parseJsonMap(json['suspended_by']);
    return EstablishmentDetail(
      id: json['id'] as String,
      partnerId: json['partner_id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      description: json['description'] as String?,
      status: json['status'] as String? ?? 'pending',
      city: json['city'] as String?,
      address: json['address'] as String?,
      latitude: _parseDouble(json['latitude']),
      longitude: _parseDouble(json['longitude']),
      phone: json['phone'] as String?,
      email: json['email'] as String?,
      website: json['website'] as String?,
      categories: _parseStringList(json['categories']),
      cuisines: _parseStringList(json['cuisines']),
      priceRange: json['price_range'] as String?,
      workingHours: json['working_hours'] as Map<String, dynamic>?,
      specialHours: json['special_hours'] as Map<String, dynamic>?,
      attributes: json['attributes'] as Map<String, dynamic>?,
      legalName: json['legal_name'] as String?,
      unp: json['unp'] as String?,
      registrationDocUrl: json['registration_doc_url'] as String?,
      contactPerson: json['contact_person'] as String?,
      contactEmail: json['contact_email'] as String?,
      interiorPhotos: _parseMediaList(json['interior_photos']),
      menuMedia: _parseMediaList(json['menu_media']),
      moderationNotes: _parseJsonMap(json['moderation_notes']),
      suspendedByName: suspendedBy?['name'] as String?,
      suspendedByAt: _parseDate(suspendedBy?['at']),
      partnerDataRedacted: json['partner_data_redacted'] == true,
      createdAt: _parseDate(json['created_at']),
      updatedAt: _parseDate(json['updated_at']),
    );
  }
}

/// Media item (photo or document)
class MediaItem {
  final String? id;

  /// Оригинал. Для PDF это сам PDF — отрисовать его как картинку нельзя.
  final String url;

  /// Миниатюра для сетки.
  final String? thumbnailUrl;

  /// Промежуточное разрешение 800×600. Для PDF — растр первой страницы,
  /// то есть единственное, что можно показать на экране.
  final String? previewUrl;

  /// `image` или `pdf`. В базе NOT NULL DEFAULT 'image', но проекция могла
  /// прийти без поля — считаем такие записи картинками.
  final String fileType;

  final bool isPrimary;

  const MediaItem({
    this.id,
    required this.url,
    this.thumbnailUrl,
    this.previewUrl,
    this.fileType = 'image',
    this.isPrimary = false,
  });

  bool get isPdf => fileType == 'pdf';

  /// Что показывать в полноэкранном просмотре.
  ///
  /// Для картинки — оригинал: модератор смотрит именно его. Для PDF оригинал
  /// нарисовать невозможно, остаётся растр первой страницы; сам файл
  /// открывается отдельным действием.
  String get viewableUrl =>
      isPdf ? (previewUrl ?? thumbnailUrl ?? url) : url;

  factory MediaItem.fromJson(Map<String, dynamic> json) {
    return MediaItem(
      id: json['id'] as String?,
      url: json['url'] as String? ?? '',
      thumbnailUrl: json['thumbnail_url'] as String?,
      previewUrl: json['preview_url'] as String?,
      fileType: json['file_type'] as String? ?? 'image',
      isPrimary: json['is_primary'] as bool? ?? false,
    );
  }
}

// ============================================================================
// Segment C: Active, Rejected, Search models
// ============================================================================

/// Model for an active (approved) establishment in the list card
class ActiveEstablishmentItem extends EstablishmentListItem {
  final DateTime? publishedAt;
  final double averageRating;
  final int viewCount;
  final int favoriteCount;
  final int reviewCount;
  final String? subscriptionTier;

  const ActiveEstablishmentItem({
    required super.id,
    required super.name,
    super.city,
    super.categories,
    super.cuisines,
    super.thumbnailUrl,
    super.updatedAt,
    super.createdAt,
    this.publishedAt,
    this.averageRating = 0.0,
    this.viewCount = 0,
    this.favoriteCount = 0,
    this.reviewCount = 0,
    this.subscriptionTier,
  });

  factory ActiveEstablishmentItem.fromJson(Map<String, dynamic> json) {
    final photo = json['primary_photo'];
    String? thumbnail;
    if (photo is Map<String, dynamic>) {
      thumbnail = photo['thumbnail_url'] as String? ?? photo['url'] as String?;
    }

    return ActiveEstablishmentItem(
      id: json['id'] as String,
      name: json['name'] as String? ?? '',
      city: json['city'] as String?,
      categories: _parseStringList(json['categories']),
      cuisines: _parseStringList(json['cuisines']),
      thumbnailUrl: thumbnail,
      updatedAt: _parseDate(json['updated_at']),
      createdAt: _parseDate(json['created_at']),
      publishedAt: _parseDate(json['published_at']),
      averageRating: _parseDouble(json['average_rating']) ?? 0.0,
      viewCount: (json['view_count'] as num?)?.toInt() ?? 0,
      favoriteCount: (json['favorite_count'] as num?)?.toInt() ?? 0,
      reviewCount: (json['review_count'] as num?)?.toInt() ?? 0,
      subscriptionTier: json['subscription_tier'] as String?,
    );
  }
}

/// Model for a suspended establishment in the list card
class SuspendedEstablishmentItem extends EstablishmentListItem {
  final String? suspendReason;
  final DateTime? suspendedAt;

  const SuspendedEstablishmentItem({
    required super.id,
    required super.name,
    super.city,
    super.categories,
    super.cuisines,
    super.thumbnailUrl,
    super.updatedAt,
    super.createdAt,
    this.suspendReason,
    this.suspendedAt,
  });

  factory SuspendedEstablishmentItem.fromJson(Map<String, dynamic> json) {
    final photo = json['primary_photo'];
    String? thumbnail;
    if (photo is Map<String, dynamic>) {
      thumbnail = photo['thumbnail_url'] as String? ?? photo['url'] as String?;
    }

    // Extract suspend_reason and suspended_at from moderation_notes
    final notes = _parseJsonMap(json['moderation_notes']);

    return SuspendedEstablishmentItem(
      id: json['id'] as String,
      name: json['name'] as String? ?? '',
      city: json['city'] as String?,
      categories: _parseStringList(json['categories']),
      cuisines: _parseStringList(json['cuisines']),
      thumbnailUrl: thumbnail,
      updatedAt: _parseDate(json['updated_at']),
      createdAt: _parseDate(json['created_at']),
      suspendReason: notes?['suspend_reason'] as String?,
      suspendedAt: _parseDate(notes?['suspended_at']),
    );
  }
}

/// Model for a rejected establishment item (from audit log)
class RejectedEstablishmentItem {
  final String auditId;
  final String establishmentId;
  final String name;
  final String? city;
  final List<String> categories;
  final List<String> cuisines;
  final String? thumbnailUrl;
  final DateTime? rejectionDate;
  final Map<String, dynamic>? rejectionNotes;
  final String currentStatus;

  const RejectedEstablishmentItem({
    required this.auditId,
    required this.establishmentId,
    required this.name,
    this.city,
    this.categories = const [],
    this.cuisines = const [],
    this.thumbnailUrl,
    this.rejectionDate,
    this.rejectionNotes,
    this.currentStatus = 'draft',
  });

  factory RejectedEstablishmentItem.fromJson(Map<String, dynamic> json) {
    final photo = json['primary_photo'];
    String? thumbnail;
    if (photo is Map<String, dynamic>) {
      thumbnail = photo['thumbnail_url'] as String? ?? photo['url'] as String?;
    }

    // Parse rejection notes from audit log new_data or establishment moderation_notes
    Map<String, dynamic>? notes;
    final newData = json['new_data'];
    if (newData is Map<String, dynamic>) {
      final innerNotes = newData['moderation_notes'];
      if (innerNotes is Map<String, dynamic>) {
        notes = innerNotes;
      }
    }
    // Fallback to establishment's moderation_notes (may be String from JSONB)
    notes ??= _parseJsonMap(json['moderation_notes']);

    return RejectedEstablishmentItem(
      auditId: json['audit_id'] as String? ?? '',
      establishmentId:
          json['establishment_id'] as String? ?? json['id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      city: json['city'] as String?,
      categories: _parseStringList(json['categories']),
      cuisines: _parseStringList(json['cuisines']),
      thumbnailUrl: thumbnail,
      rejectionDate: _parseDate(json['rejection_date']),
      rejectionNotes: notes,
      currentStatus: json['current_status'] as String? ?? 'draft',
    );
  }

  /// Localized status label for display
  String get statusLabel {
    switch (currentStatus) {
      case 'draft':
        return 'Черновик';
      case 'pending':
        return 'На модерации';
      case 'active':
        return 'Активно';
      default:
        return currentStatus;
    }
  }
}

/// Model for search results (establishment with status badge)
class SearchResultItem extends EstablishmentListItem {
  final String status;
  final DateTime? publishedAt;

  const SearchResultItem({
    required super.id,
    required super.name,
    super.city,
    super.categories,
    super.cuisines,
    super.phone,
    super.email,
    super.thumbnailUrl,
    super.updatedAt,
    super.createdAt,
    required this.status,
    this.publishedAt,
  });

  factory SearchResultItem.fromJson(Map<String, dynamic> json) {
    final photo = json['primary_photo'];
    String? thumbnail;
    if (photo is Map<String, dynamic>) {
      thumbnail = photo['thumbnail_url'] as String? ?? photo['url'] as String?;
    }

    return SearchResultItem(
      id: json['id'] as String,
      name: json['name'] as String? ?? '',
      city: json['city'] as String?,
      categories: _parseStringList(json['categories']),
      cuisines: _parseStringList(json['cuisines']),
      phone: json['phone'] as String?,
      email: json['email'] as String?,
      thumbnailUrl: thumbnail,
      updatedAt: _parseDate(json['updated_at']),
      createdAt: _parseDate(json['created_at']),
      status: json['status'] as String? ?? 'draft',
      publishedAt: _parseDate(json['published_at']),
    );
  }

  /// Localized status label for display
  String get statusLabel {
    switch (status) {
      case 'active':
        return 'Активно';
      case 'suspended':
        return 'Приостановлено';
      case 'pending':
        return 'На модерации';
      case 'draft':
        return 'Черновик';
      case 'archived':
        return 'Архив';
      default:
        return status;
    }
  }
}

// Shared helpers

List<String> _parseStringList(dynamic value) {
  if (value is List) {
    return value.map((e) => e.toString()).toList();
  }
  return [];
}

List<MediaItem> _parseMediaList(dynamic value) {
  if (value is List) {
    return value
        .map((e) => e is Map<String, dynamic> ? MediaItem.fromJson(e) : null)
        .whereType<MediaItem>()
        .toList();
  }
  return [];
}

DateTime? _parseDate(dynamic value) {
  if (value is String) return DateTime.tryParse(value);
  return null;
}

double? _parseDouble(dynamic value) {
  if (value is num) return value.toDouble();
  if (value is String) return double.tryParse(value);
  return null;
}

/// Parse a JSON map that may arrive as Map or as a JSON-encoded String.
/// PostgreSQL JSONB columns sometimes return string-wrapped values (e.g. "{}")
/// when the value was stored as a JSON string instead of a JSON object.
Map<String, dynamic>? _parseJsonMap(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is String && value.isNotEmpty) {
    try {
      final decoded = jsonDecode(value);
      if (decoded is Map<String, dynamic>) return decoded;
    } catch (_) {
      // Malformed JSON — ignore
    }
  }
  return null;
}
