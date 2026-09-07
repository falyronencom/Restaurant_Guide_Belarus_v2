/// Distance filter options (single selection)
enum DistanceOption {
  m500,   // В радиусе 500 м
  km1,    // В радиусе 1 км
  km3,    // В радиусе 3 км
  km5,    // В радиусе 5 км
  km10,   // В радиусе 10 км
  all;    // Весь город (default)

  /// Convert to meters for API
  int? toMeters() {
    switch (this) {
      case DistanceOption.m500:
        return 500;
      case DistanceOption.km1:
        return 1000;
      case DistanceOption.km3:
        return 3000;
      case DistanceOption.km5:
        return 5000;
      case DistanceOption.km10:
        return 10000;
      case DistanceOption.all:
        return null; // No distance limit
    }
  }

  /// Display label in Russian
  String get displayLabel {
    switch (this) {
      case DistanceOption.m500:
        return 'В радиусе 500 м';
      case DistanceOption.km1:
        return 'В радиусе 1 км';
      case DistanceOption.km3:
        return 'В радиусе 3 км';
      case DistanceOption.km5:
        return 'В радиусе 5 км';
      case DistanceOption.km10:
        return 'В радиусе 10 км';
      case DistanceOption.all:
        return 'Весь город';
    }
  }
}

/// Price range filter options (multi-selection)
enum PriceRange {
  budget,    // $ (< 20 бел. руб)
  medium,    // $$ (< 50 бел. руб)
  expensive; // $$$ (> 50 бел. руб)

  /// Symbol for display
  String get symbol {
    switch (this) {
      case PriceRange.budget:
        return '\$';
      case PriceRange.medium:
        return '\$\$';
      case PriceRange.expensive:
        return '\$\$\$';
    }
  }

  /// Description text
  String get description {
    switch (this) {
      case PriceRange.budget:
        return '< 20 бел. руб';
      case PriceRange.medium:
        return '< 50 бел. руб';
      case PriceRange.expensive:
        return '> 50 бел. руб';
    }
  }

  /// API value
  String get apiValue {
    switch (this) {
      case PriceRange.budget:
        return '\$';
      case PriceRange.medium:
        return '\$\$';
      case PriceRange.expensive:
        return '\$\$\$';
    }
  }
}

/// Operating hours filter options (single selection)
enum HoursFilter {
  until22,      // До 22:00
  untilMorning, // До утра
  hours24;      // 24 ч.

  /// Display label in Russian
  String get displayLabel {
    switch (this) {
      case HoursFilter.until22:
        return 'До 22:00';
      case HoursFilter.untilMorning:
        return 'До утра';
      case HoursFilter.hours24:
        return '24 ч.';
    }
  }

  /// API parameter value
  String get apiValue {
    switch (this) {
      case HoursFilter.until22:
        return 'until_22';
      case HoursFilter.untilMorning:
        return 'until_morning';
      case HoursFilter.hours24:
        return '24_hours';
    }
  }
}

/// Filter constants - categories, cuisines, and amenities
/// Based on Figma design
class FilterConstants {
  FilterConstants._();

  /// Establishment categories (15 items)
  static const List<String> categories = [
    'Ресторан',
    'Кофейня',
    'Кафе',
    'Фаст-фуд',
    'Пиццерия',
    'Бар',
    'Паб',
    'Кондитерская',
    'Пекарня',
    'Караоке',
    'Столовая',
    'Кальянная',
    'Боулинг',
    'Бильярд',
    'Клуб',
  ];

  /// Cuisine types (12 items)
  static const List<String> cuisines = [
    'Народная',
    'Американская',
    'Азиатская',
    'Вегетарианская',
    'Итальянская',
    'Смешанная',
    'Грузинская',
    'Европейская',
    'Японская',
    'Авторская',
    'Китайская',
    'Восточная',
  ];

  /// Удобства — канон-10 бэкенда (`ATTRIBUTE_CANON`, SDL CAT-C-3.15) за
  /// вычетом `accessible_environment`: на него нет ни иконки в
  /// `assets/icons/`, ни подписи в web. Прежний набор из 14 ключей был взят
  /// из макета и с каноном не сверялся: девять его ключей не мог нести ни один
  /// объект, а `searchService` соединяет условия через AND без белого списка,
  /// поэтому один такой ключ обнулял выдачу вместе с остальными фильтрами.
  /// Ключ = код API, значение = подпись. Подписи совпадают с карточкой
  /// заведения и с web `ATTRIBUTE_LABELS` — гость видит одно слово в обоих
  /// местах. Порядок — `ATTRIBUTE_ORDER` из web.
  /// Сторож: `test/config/vocabulary_canon_guard_test.dart`.
  static const Map<String, String> amenities = {
    'delivery': 'Доставка еды',
    'wifi': 'Wi-Fi',
    'terrace': 'Терасса',
    'parking': 'Парковка',
    'live_music': 'Живая музыка',
    'kids_zone': 'Детская зона',
    'banquet': 'Банкет',
    'pets_allowed': 'Животные',
    'smoking': 'Курение',
  };

  /// Get amenity display label by code
  static String? getAmenityLabel(String code) => amenities[code];

  /// Get all amenity codes
  static List<String> get amenityCodes => amenities.keys.toList();

  /// Get all amenity labels
  static List<String> get amenityLabels => amenities.values.toList();
}
