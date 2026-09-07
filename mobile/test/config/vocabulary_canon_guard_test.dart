import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/config/cities.dart';
import 'package:restaurant_guide_mobile/models/filter_options.dart';
import 'package:restaurant_guide_mobile/models/notification_model.dart';

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

  // ==========================================================================
  // Четвёртое пространство ключей — типы уведомлений.
  // Найдено 07.09.2026 при разборе контракта провода: `NotificationType`
  // знал шестнадцать типов из семнадцати, а `fromString` на неизвестном
  // значении молча отдаёт `newReview`. «Позиция меню скрыта модератором»
  // приезжала со звездой отзыва, жёлтым цветом и в чужую вкладку фильтра.
  // ==========================================================================

  // backend/src/services/notificationService.js → TITLES (17)
  const canonNotificationTypes = <String>[
    'establishment_approved',
    'establishment_rejected',
    'establishment_suspended',
    'establishment_unsuspended',
    'establishment_claimed',
    'new_review',
    'partner_response',
    'review_hidden',
    'review_deleted',
    'booking_received',
    'booking_confirmed',
    'booking_declined',
    'booking_expired',
    'booking_cancelled',
    'promotion_new',
    'menu_parsed',
    'menu_item_hidden_by_admin',
  ];

  group('Типы уведомлений против канона бэкенда', () {
    test('каждый тип бэкенда разбирается в СВОЙ тип приложения', () {
      // `NotificationType.fromString` не умеет сказать «не знаю»: неизвестное
      // значение становится `newReview`. Поэтому нераспознанный тип виден
      // только по столкновению — два разных кода бэкенда дали один тип
      // приложения, значит один из них на самом деле не разобран.
      final seen = <NotificationType, String>{};
      final collisions = <String>[];

      for (final code in canonNotificationTypes) {
        final parsed = NotificationType.fromString(code);
        if (seen.containsKey(parsed)) {
          collisions.add('$code → ${parsed.name}, уже занят «${seen[parsed]}»');
        } else {
          seen[parsed] = code;
        }
      }

      expect(
        collisions,
        isEmpty,
        reason: 'тип с бэкенда подменён чужим: $collisions. Уведомление '
            'получит чужую иконку, чужой цвет и чужую вкладку, оставаясь '
            'на вид исправным',
      );
    });

    test('в приложении нет типов сверх канона бэкенда', () {
      // Обратное направление: тип, которого бэкенд не шлёт, — мёртвая ветка
      // в трёх switch подряд, и она переживёт удаление типа на бэкенде.
      expect(NotificationType.values, hasLength(canonNotificationTypes.length));
    });
  });

  // ==========================================================================
  // Пятое пространство ключей — города.
  // Поиск фильтрует строгим равенством (`e.city = $1` в searchService), а
  // бэкенд принимает ОБА написания Могилёва. Город, записанный не тем
  // написанием, для мобильного фильтра не существует, и отказ молчаливый:
  // приложение честно отвечает, что заведений в городе нет.
  // ==========================================================================

  // backend/src/services/establishmentService.js → VALID_CITIES (8)
  const canonCities = <String>{
    'Минск', 'Гродно', 'Брест', 'Гомель', 'Витебск',
    'Могилев', 'Могилёв', 'Бобруйск',
  };

  group('Города против канона бэкенда', () {
    test('каждый город приложения принимается бэкендом', () {
      final offered =
          BelarusCities.citiesWithRegions.map((c) => c['city']!).toSet();
      expect(
        offered.difference(canonCities),
        isEmpty,
        reason: 'город вне канона бэкенда даст пустую выдачу при строгом '
            'сравнении e.city = \$1',
      );
    });

    test('город по умолчанию входит в список выбора', () {
      final offered =
          BelarusCities.citiesWithRegions.map((c) => c['city']!).toSet();
      expect(offered, contains(BelarusCities.defaultCity));
    });

    test('ГРАНИЦА: из двух написаний Могилёва приложение шлёт одно', () {
      // Бэкенд принимает и «Могилев», и «Могилёв»; канонизация URL в web
      // (`urlSlugs.js`) обратным отображением отдаёт «Могилев» — через «е».
      // Мобильный фильтр шлёт «Могилёв» через «ё», а поиск сравнивает строки
      // точно. Карточка, записанная через «е», в мобильной выдаче не
      // появится, и выглядеть это будет как «в городе пока ничего нет».
      //
      // Разрыв закреплён здесь намеренно: закрыть его должен бэкенд
      // (нормализация ё→е при записи и при сравнении), приложение своими
      // силами этого сделать не может. Тест обязан покраснеть, если список
      // городов правят, не разобравшись с этой парой.
      final offered =
          BelarusCities.citiesWithRegions.map((c) => c['city']!).toSet();

      expect(offered.contains('Могилёв'), isTrue);
      expect(
        offered.contains('Могилев'),
        isFalse,
        reason: 'если появилось второе написание — значит пару начали чинить '
            'на клиенте; проверьте, что бэкенд и данные согласованы',
      );
    });
  });
}
