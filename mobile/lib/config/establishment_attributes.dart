/// Атрибуты заведения для гостевой карточки: какие показывать и чем рисовать.
///
/// Вынесено из `detail_screen._buildAttributesSection`, где та же таблица была
/// развёрнута девятью подряд идущими `if` внутри метода виджета и потому не
/// проверялась ничем. Здесь она — чистая функция, у которой есть тест.
///
/// Ключи — канон бэкенда (`ATTRIBUTE_CANON`, SDL CAT-C-3.15) за вычетом
/// `accessible_environment`: на него нет иконки в `assets/icons/`. Порядок и
/// подписи совпадают с web (`ATTRIBUTE_ORDER` / `ATTRIBUTE_LABELS`) и с
/// фильтром (`FilterConstants.amenities`), чтобы гость видел одно слово всюду.
/// Расхождение словарей стережёт `test/config/vocabulary_canon_guard_test.dart`.
class EstablishmentAttributes {
  EstablishmentAttributes._();

  /// `key` — код в JSONB `attributes`; `name` — подпись; `svg` — имя файла в
  /// `assets/icons/` без расширения (см. `_buildAmenityItem`).
  static const List<Map<String, String>> canon = [
    {'key': 'delivery', 'name': 'Доставка еды', 'svg': 'Доставка еды'},
    {'key': 'wifi', 'name': 'Wi-Fi', 'svg': 'Wifi'},
    {'key': 'terrace', 'name': 'Терасса', 'svg': 'Терасса'},
    {'key': 'parking', 'name': 'Парковка', 'svg': 'Парковка'},
    {'key': 'live_music', 'name': 'Живая музыка', 'svg': 'Живая музыка'},
    {'key': 'kids_zone', 'name': 'Детская зона', 'svg': 'Детская зона'},
    {'key': 'banquet', 'name': 'Банкет', 'svg': 'Банкет'},
    {'key': 'pets_allowed', 'name': 'Животные', 'svg': 'Животные'},
    {'key': 'smoking', 'name': 'Курение', 'svg': 'Курение'},
  ];

  /// Только те атрибуты, которые заведение действительно несёт.
  ///
  /// Пустой результат означает ровно «данных нет» и обязан оставаться пустым.
  /// Прежний код при пустом результате подставлял «Доставка еды · Wi-Fi ·
  /// Терасса», и гость не мог отличить подстановку от факта. Подставлять
  /// значения по умолчанию здесь нельзя: карточки на старте заполняются
  /// вручную, и пустые `attributes` — обычное дело, а не сбой.
  static List<Map<String, String>> active(Map<String, dynamic>? attributes) {
    if (attributes == null || attributes.isEmpty) return const [];
    return canon
        .where((item) => attributes[item['key']] == true)
        .map((item) => {'name': item['name']!, 'svg': item['svg']!})
        .toList(growable: false);
  }
}
