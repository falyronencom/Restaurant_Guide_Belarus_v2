import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/models/filter_options.dart';

/// Сторож трёх словарей мобильного фильтра против канона бэкенда.
///
/// Зачем: ключи фильтра уходят на бэкенд как есть (`features` → провайдер →
/// `establishments_service`), а `searchService` строит по каждому
/// `(e.attributes->>$N)::boolean = true` БЕЗ белого списка. Ключ, которого нет
/// ни на одной карточке, даёт NULL, строка не проходит, а условия соединяются
/// через AND — то есть один мёртвый ключ обнуляет и все остальные выбранные
/// фильтры. Отказ молчаливый: приложение не падает, а честно отвечает, что
/// ничего не найдено.
///
/// Эталон ниже — зеркало `backend/src/constants/establishmentVocab.js`.
/// Общего источника у Dart и JS нет, поэтому список продублирован здесь
/// намеренно: сторож существует ровно затем, чтобы дубль не разошёлся молча.
/// При изменении канона на бэкенде этот тест обязан покраснеть первым.
void main() {
  // backend/src/constants/establishmentVocab.js → VALID_CATEGORIES (15)
  const canonCategories = <String>{
    'Ресторан', 'Кофейня', 'Кафе', 'Фаст-фуд', 'Бар', 'Кондитерская',
    'Пиццерия', 'Пекарня', 'Паб', 'Столовая', 'Кальянная', 'Боулинг',
    'Караоке', 'Бильярд', 'Клуб',
  };

  // backend/src/constants/establishmentVocab.js → VALID_CUISINES (12)
  const canonCuisines = <String>{
    'Народная', 'Авторская', 'Азиатская', 'Американская', 'Вегетарианская',
    'Японская', 'Грузинская', 'Итальянская', 'Смешанная', 'Европейская',
    'Китайская', 'Восточная',
  };

  // backend/src/constants/establishmentVocab.js → ATTRIBUTE_CANON (10),
  // ратифицирован SDL CAT-C-3.15.
  const canonAttributes = <String>{
    'delivery', 'wifi', 'terrace', 'parking', 'live_music', 'kids_zone',
    'banquet', 'pets_allowed', 'smoking', 'accessible_environment',
  };

  /// Канонический ключ, который приложение намеренно НЕ предлагает в фильтре:
  /// его нечем нарисовать. Карточка заведения знает девять атрибутов, и на
  /// каждый есть иконка в `assets/icons/`; на доступную среду иконки нет, а
  /// `ATTRIBUTE_LABELS` в web её тоже не несёт. Предложить фильтр, результат
  /// которого гость не сможет подтвердить глазами, — хуже, чем не предложить.
  /// Разрыв закреплён здесь, чтобы он не разошёлся молча: появится иконка —
  /// этот тест покраснеет и потребует внести ключ в фильтр.
  const deliberatelyNotOffered = <String>{'accessible_environment'};

  group('Словари фильтра против канона бэкенда', () {
    test('категории совпадают с каноном ровно', () {
      expect(FilterConstants.categories.toSet(), canonCategories);
      expect(FilterConstants.categories.length, canonCategories.length,
          reason: 'дубль в списке категорий');
    });

    test('кухни совпадают с каноном ровно', () {
      expect(FilterConstants.cuisines.toSet(), canonCuisines);
      expect(FilterConstants.cuisines.length, canonCuisines.length,
          reason: 'дубль в списке кухонь');
    });

    test('ни один ключ удобств не выходит за канон', () {
      final offered = FilterConstants.amenities.keys.toSet();
      final dead = offered.difference(canonAttributes);
      expect(
        dead,
        isEmpty,
        reason: 'ключи вне канона бэкенда гарантированно дают пустую выдачу и '
            'обнуляют все остальные выбранные фильтры: $dead',
      );
    });

    test('предложены все канонические ключи, кроме намеренно отложенных', () {
      final offered = FilterConstants.amenities.keys.toSet();
      expect(canonAttributes.difference(offered), deliberatelyNotOffered);
    });

    test('у каждого предложенного удобства есть непустая подпись', () {
      for (final entry in FilterConstants.amenities.entries) {
        expect(entry.value.trim(), isNotEmpty,
            reason: 'пустая подпись у ключа ${entry.key}');
      }
    });
  });
}
