import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/services/smart_search_service.dart';

/// Форма `data.intent` — как её отдаёт backend (`intentSchema` в
/// `smartSearchService.js`): все ключи присутствуют, отсутствующие значения —
/// null, `tags` — всегда список.
/// Mirrors the backend's Zod `intentSchema`: every key present, null for
/// absent values, `tags` always a list.
Map<String, dynamic> _intent({
  String? category,
  List<String>? cuisine,
  String? dish,
  String? mealType,
  num? priceMax,
  String? location,
  String? sort,
  List<String> tags = const [],
}) =>
    {
      'category': category,
      'cuisine': cuisine,
      'dish': dish,
      'meal_type': mealType,
      'price_max': priceMax,
      'location': location,
      'sort': sort,
      'tags': tags,
      'error': null,
    };

void main() {
  group('SmartSearchIntent.fromJson', () {
    test('читает dish вместе с остальными полями intent', () {
      final intent = SmartSearchIntent.fromJson(_intent(
        category: 'Пиццерия',
        cuisine: ['Итальянская'],
        dish: 'пицца',
        mealType: 'обед',
        priceMax: 20,
        location: 'Минск',
        sort: 'price_asc',
        tags: ['пицца'],
      ));

      expect(intent.dish, 'пицца');
      expect(intent.category, 'Пиццерия');
      expect(intent.cuisine, ['Итальянская']);
      expect(intent.mealType, 'обед');
      expect(intent.priceMax, 20.0);
      expect(intent.location, 'Минск');
      expect(intent.sort, 'price_asc');
      expect(intent.tags, ['пицца']);
    });

    test('null-поля backend дают null, tags — пустой список', () {
      final intent = SmartSearchIntent.fromJson(_intent());

      expect(intent.dish, isNull);
      expect(intent.category, isNull);
      expect(intent.cuisine, isNull);
      expect(intent.priceMax, isNull);
      expect(intent.location, isNull);
      expect(intent.sort, isNull);
      expect(intent.tags, isEmpty);
    });

    test('ответ без ключа dish (старый backend) — null, не исключение', () {
      final legacy = _intent(category: 'Кафе')..remove('dish');

      final intent = SmartSearchIntent.fromJson(legacy);

      expect(intent.dish, isNull);
      expect(intent.toDisplayString(), 'Кафе');
    });
  });

  group('SmartSearchIntent.toDisplayString', () {
    test('запрос «пицца» показывает блюдо, а не пустую строку', () {
      final intent = SmartSearchIntent.fromJson(
        _intent(dish: 'пицца', tags: ['пицца']),
      );

      expect(intent.toDisplayString(), 'пицца');
    });

    test('«пицца до 20 рублей» → «пицца · до 20 BYN», без хвоста «.0»', () {
      // price_max приходит числом 20.0 — раньше печаталось «до 20.0 BYN»
      // / price_max arrives as 20.0 — used to print "до 20.0 BYN"
      final intent = SmartSearchIntent.fromJson(
        _intent(dish: 'пицца', priceMax: 20.0, tags: ['пицца']),
      );

      expect(intent.toDisplayString(), 'пицца · до 20 BYN');
    });

    test('дробная цена печатается как есть', () {
      final intent = SmartSearchIntent.fromJson(_intent(priceMax: 19.5));

      expect(intent.toDisplayString(), 'до 19.5 BYN');
    });

    test('блюдо идёт первым, дальше прежний порядок частей', () {
      final intent = SmartSearchIntent.fromJson(_intent(
        category: 'Пиццерия',
        cuisine: ['Итальянская', 'Европейская'],
        dish: 'пицца',
        priceMax: 25,
        location: 'Минск',
        sort: 'distance',
      ));

      expect(
        intent.toDisplayString(),
        'пицца · Пиццерия · Итальянская, Европейская · '
        'до 25 BYN · Минск · рядом с вами',
      );
    });

    test('сортировки подписаны по-русски', () {
      expect(
        SmartSearchIntent.fromJson(_intent(sort: 'rating')).toDisplayString(),
        'лучшие',
      );
      expect(
        SmartSearchIntent.fromJson(_intent(sort: 'price_asc'))
            .toDisplayString(),
        'недорого',
      );
    });

    test('пустой intent — пустая строка', () {
      expect(SmartSearchIntent.fromJson(_intent()).toDisplayString(), '');
    });
  });

  group('SmartSearchResult.fromJson', () {
    test('dish доходит через конверт data.intent', () {
      final result = SmartSearchResult.fromJson({
        'success': true,
        'data': {
          'intent': _intent(dish: 'капучино', tags: ['капучино']),
          'establishments': <Map<String, dynamic>>[],
          'pagination': {'total': 0},
          'fallback': false,
        },
      });

      expect(result.intent?.dish, 'капучино');
      expect(result.intent?.toDisplayString(), 'капучино');
      expect(result.fallback, isFalse);
      expect(result.total, 0);
      expect(result.results, isEmpty);
    });

    test('fallback без intent — intent null', () {
      final result = SmartSearchResult.fromJson({
        'success': true,
        'data': {
          'intent': null,
          'establishments': <Map<String, dynamic>>[],
          'pagination': {'total': 0},
          'fallback': true,
        },
      });

      expect(result.intent, isNull);
      expect(result.fallback, isTrue);
    });
  });
}
