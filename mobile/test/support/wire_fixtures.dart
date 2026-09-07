/// Снимки провода — то, что бэкенд РЕАЛЬНО кладёт в ответ.
///
/// Значения здесь литеральные и списаны с проекций бэкенда поимённо. Это
/// сделано намеренно: помощник, который вычислял бы входные данные той же
/// арифметикой, что и проверяемый код, соглашался бы с кодом по построению —
/// включая места, где код неправ (форма 2 брифа аудита). Здесь ожидание
/// приходит из спецификации провода, а не из прогона.
///
/// Источники, с которыми эти карты обязаны совпадать:
///   `backend/src/projections/establishmentProjections.js` — список и деталь
///   `backend/src/controllers/searchController.js`         — конверт поиска
///   `backend/src/services/searchService.js`               — блок pagination
///   `backend/src/services/reviewService.js`               — блок отзывов
library;

/// Строка списка заведений — полный набор ключей публичной проекции.
///
/// Разошлась проекция — этот снимок обязан разойтись вместе с ней, иначе
/// тесты будут проверять контракт, которого больше нет.
Map<String, dynamic> establishmentRow({
  String id = '11111111-1111-4111-8111-111111111111',
  String name = 'Васильки',
  String city = 'Минск',
  String address = 'пр. Независимости, 43',
  String status = 'active',
  List<String> categories = const ['Ресторан'],
  List<String> cuisines = const ['Народная'],
  Map<String, dynamic>? workingHours,
  Map<String, dynamic>? attributes,
  List<dynamic> media = const [],
  List<dynamic> promotions = const [],
}) =>
    <String, dynamic>{
      'id': id,
      'slug': 'vasilki-minsk',
      'name': name,
      'description': 'Белорусская кухня в центре',
      'city': city,
      'city_slug': 'minsk',
      'address': address,
      // Проекция прогоняет широту и долготу через parseFloat — на проводе
      // это числа, а не строки NUMERIC. Модель кастует их как `as num`, и
      // возврат строки её уронит.
      'latitude': 53.9023,
      'longitude': 27.5619,
      'phone': '+375291234567',
      'email': 'hello@vasilki.by',
      'website': 'https://vasilki.by',
      'categories': categories,
      'category_slug': 'restoran',
      'cuisines': cuisines,
      'price_range': '\$\$',
      'working_hours': workingHours,
      'special_hours': null,
      'attributes': attributes,
      'status': status,
      'primary_image_url': 'https://cdn.example/vasilki',
      'review_count': 12,
      'average_rating': 4.5,
      'favorite_count': 3,
      'view_count': 140,
      'booking_enabled': true,
      'has_promotion': false,
      'promotion_count': 0,
      'published_at': '2026-05-01T10:00:00.000Z',
      'created_at': '2026-04-01T09:00:00.000Z',
      'updated_at': '2026-06-01T09:00:00.000Z',
      'media': media,
      'promotions': promotions,
    };

/// Строка медиа заведения.
Map<String, dynamic> mediaRow({
  String id = '22222222-2222-4222-8222-222222222222',
  String type = 'photo',
  String? fileType,
  int position = 0,
}) =>
    <String, dynamic>{
      'id': id,
      'establishment_id': '11111111-1111-4111-8111-111111111111',
      'type': type,
      if (fileType != null) 'file_type': fileType,
      'thumbnail_url': 'https://cdn.example/thumb',
      'preview_url': 'https://cdn.example/preview',
      'url': 'https://cdn.example/full',
      'caption': null,
      'position': position,
      'created_at': '2026-04-01T09:00:00.000Z',
    };

/// Конверт `/api/v1/search/establishments`.
///
/// Форма — `{ success, data: { establishments, pagination } }`, а внутри
/// `pagination` ключи `page` / `limit` / `total` / `totalPages`
/// (`searchService.js`, обе ветки поиска). Именно эти четыре имени сервис
/// mobile перекладывает в `per_page` / `total_pages`, и именно они молча
/// подменяются значениями по умолчанию, если разойдутся.
Map<String, dynamic> searchEnvelope({
  List<Map<String, dynamic>>? establishments,
  int page = 1,
  int limit = 20,
  int total = 45,
  int totalPages = 3,
}) =>
    <String, dynamic>{
      'success': true,
      'data': <String, dynamic>{
        'establishments': establishments ?? [establishmentRow()],
        'pagination': <String, dynamic>{
          'page': page,
          'limit': limit,
          'total': total,
          'totalPages': totalPages,
        },
      },
    };

/// Строка отзыва во вложенной форме `author` — так отдаёт публичный список.
Map<String, dynamic> reviewRow({
  String id = '33333333-3333-4333-8333-333333333333',
  String authorName = 'Ирина',
  int rating = 5,
  String? content = 'Драники как у бабушки',
  String? partnerResponse,
}) =>
    <String, dynamic>{
      'id': id,
      'establishment_id': '11111111-1111-4111-8111-111111111111',
      'author': <String, dynamic>{
        'id': '44444444-4444-4444-8444-444444444444',
        'name': authorName,
        'avatar_url': '/uploads/avatars/irina.jpg',
      },
      'rating': rating,
      'content': content,
      'created_at': '2026-06-10T18:30:00.000Z',
      'updated_at': '2026-06-10T18:30:00.000Z',
      if (partnerResponse != null) 'partner_response': partnerResponse,
      if (partnerResponse != null)
        'partner_response_at': '2026-06-11T09:00:00.000Z',
      if (partnerResponse != null)
        'partner_responder_id': '55555555-5555-4555-8555-555555555555',
    };

/// Конверт списка отзывов: `{ success, data: { reviews, pagination } }`,
/// внутри `pagination` — `page` / `limit` / `total` / `pages`.
/// Обратите внимание: здесь `pages`, а в поиске `totalPages`. Два разных
/// имени на одном бэкенде — причина, по которой обе модели читают их с
/// запасными вариантами, и причина проверять оба пути отдельно.
Map<String, dynamic> reviewsEnvelope({
  List<Map<String, dynamic>>? reviews,
  int page = 1,
  int limit = 25,
  int total = 24,
  int pages = 3,
}) =>
    <String, dynamic>{
      'success': true,
      'data': <String, dynamic>{
        'reviews': reviews ?? [reviewRow()],
        'pagination': <String, dynamic>{
          'page': page,
          'limit': limit,
          'total': total,
          'pages': pages,
        },
      },
    };

/// Копия карты без указанного ключа — «поле пропало из проекции».
Map<String, dynamic> without(Map<String, dynamic> row, String key) {
  final copy = Map<String, dynamic>.from(row);
  copy.remove(key);
  return copy;
}

/// Копия карты, где ключ переименован — «поле переехало в проекции».
/// Отличается от [without] тем, что значение остаётся в ответе: это ловит
/// код, который смотрит на наличие данных вообще, а не на конкретное имя.
Map<String, dynamic> renamed(
  Map<String, dynamic> row,
  String from,
  String to,
) {
  final copy = Map<String, dynamic>.from(row);
  copy[to] = copy.remove(from);
  return copy;
}
