import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/models/partner_analytics.dart';
import 'package:restaurant_guide_mobile/models/partner_establishment.dart';
import 'package:restaurant_guide_mobile/models/partner_menu_item.dart';
import 'package:restaurant_guide_mobile/models/promotion.dart';

/// Контракт провода для партнёрских моделей и акций.
///
/// Партнёрский путь на мобильном вне критического пути запуска — карточки
/// заводятся через web-кабинет. Но модели общие: `Promotion` приезжает и в
/// гостевую карточку заведения, а `PartnerEstablishment` подставляет пустую
/// строку вместо имени — это молчаливая подмена того же рода, что чинили
/// 07.09 в атрибутах.
void main() {
  group('Акция', () {
    Map<String, dynamic> promotionRow({
      String? validUntil,
      String status = 'active',
    }) =>
        <String, dynamic>{
          'id': 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          'establishment_id': '11111111-1111-4111-8111-111111111111',
          'title': 'Скидка 20% на завтраки',
          'description': 'Будни до 12:00',
          'terms_and_conditions': 'Не суммируется',
          'image_url': 'https://cdn.example/promo',
          'valid_from': '2026-06-01T00:00:00.000Z',
          if (validUntil != null) 'valid_until': validUntil,
          'status': status,
          'position': 2,
          'created_at': '2026-05-25T09:00:00.000Z',
        };

    test('строка ответа разбирается целиком', () {
      final p = Promotion.fromJson(promotionRow());

      expect(p.title, 'Скидка 20% на завтраки');
      expect(p.description, 'Будни до 12:00');
      expect(p.termsAndConditions, 'Не суммируется');
      expect(p.imageUrl, 'https://cdn.example/promo');
      expect(p.position, 2);
      expect(p.validFrom, DateTime.utc(2026, 6, 1));
      expect(p.createdAt, DateTime.utc(2026, 5, 25, 9));
    });

    test('акция без срока окончания не считается истёкшей', () {
      // Бессрочная акция — обычное дело; тихое «истекла» скрыло бы её от
      // гостя навсегда.
      final p = Promotion.fromJson(promotionRow());
      expect(p.isExpired, isFalse);
      expect(p.isActive, isTrue);
    });

    test('срок в прошлом делает акцию истёкшей и неактивной', () {
      final p = Promotion.fromJson(promotionRow(
        validUntil: DateTime.now()
            .subtract(const Duration(days: 1))
            .toIso8601String(),
      ));
      expect(p.isExpired, isTrue);
      expect(p.isActive, isFalse);
    });

    test('срок в будущем оставляет акцию активной', () {
      final p = Promotion.fromJson(promotionRow(
        validUntil:
            DateTime.now().add(const Duration(days: 30)).toIso8601String(),
      ));
      expect(p.isExpired, isFalse);
      expect(p.isActive, isTrue);
    });

    test('скрытая модератором акция неактивна даже в свой срок', () {
      final p = Promotion.fromJson(promotionRow(
        status: 'hidden_by_admin',
        validUntil:
            DateTime.now().add(const Duration(days: 30)).toIso8601String(),
      ));
      expect(p.isActive, isFalse,
          reason: 'решение модератора важнее срока действия');
    });

    test('статус по умолчанию — активна', () {
      final row = Map<String, dynamic>.from(promotionRow())..remove('status');
      expect(Promotion.fromJson(row).status, 'active');
    });

    test('битая дата окончания даёт null, а не исключение', () {
      final p = Promotion.fromJson(promotionRow(validUntil: 'скоро'));
      expect(p.validUntil, isNull);
      expect(p.isExpired, isFalse);
    });
  });

  group('Позиция меню', () {
    Map<String, dynamic> menuItemRow({
      dynamic price = 24.5,
      dynamic sanityFlag,
    }) =>
        <String, dynamic>{
          'id': 'ffffffff-ffff-4fff-8fff-ffffffffffff',
          'establishment_id': '11111111-1111-4111-8111-111111111111',
          'media_id': '22222222-2222-4222-8222-222222222222',
          'item_name': 'Драники со сметаной',
          'price_byn': price,
          'category_raw': 'Горячие блюда',
          'confidence': 0.94,
          'sanity_flag': sanityFlag,
          'position': 3,
        };

    test('строка ответа разбирается целиком', () {
      final m = PartnerMenuItem.fromJson(menuItemRow());

      expect(m.itemName, 'Драники со сметаной');
      expect(m.priceByn, 24.5);
      expect(m.categoryRaw, 'Горячие блюда');
      expect(m.confidence, 0.94);
      expect(m.position, 3);
      expect(m.hasSanityFlag, isFalse);
    });

    test('цена приходит строкой NUMERIC и разбирается', () {
      // `price_byn` — NUMERIC в базе; без явного каста node-pg отдаёт строку.
      expect(PartnerMenuItem.fromJson(menuItemRow(price: '24.50')).priceByn,
          24.5);
    });

    test('цены нет — null, а не ноль', () {
      // Ноль означал бы «бесплатно» и был бы напечатан на карточке как факт.
      expect(PartnerMenuItem.fromJson(menuItemRow(price: null)).priceByn,
          isNull);
    });

    test('нечисловая цена даёт null, а не исключение', () {
      expect(PartnerMenuItem.fromJson(menuItemRow(price: 'по запросу'))
          .priceByn, isNull);
    });

    test('пустой признак сомнения — это отсутствие сомнения', () {
      expect(
        PartnerMenuItem.fromJson(menuItemRow(sanityFlag: <String, dynamic>{}))
            .hasSanityFlag,
        isFalse,
      );
    });

    test('непустой признак сомнения поднимает флаг', () {
      final m = PartnerMenuItem.fromJson(
        menuItemRow(sanityFlag: <String, dynamic>{'price_out_of_range': true}),
      );
      expect(m.hasSanityFlag, isTrue);
      expect(m.sanityFlag, {'price_out_of_range': true});
    });

    test('признак сомнения не той формы игнорируется, а не роняет разбор', () {
      final m = PartnerMenuItem.fromJson(menuItemRow(sanityFlag: 'подозрительно'));
      expect(m.sanityFlag, isNull);
      expect(m.hasSanityFlag, isFalse);
    });

    test('копия сохраняет то, что не меняли', () {
      final m = PartnerMenuItem.fromJson(menuItemRow());
      final c = m.copyWith(itemName: 'Драники');

      expect(c.itemName, 'Драники');
      expect(c.id, m.id);
      expect(c.priceByn, m.priceByn);
      expect(c.position, m.position);
      expect(c.confidence, m.confidence);
    });
  });

  group('Показатели кабинета', () {
    test('метрика разбирается, включая изменение в процентах', () {
      final m = AnalyticsMetric.fromJson(<String, dynamic>{
        'total': 742,
        'in_period': 96,
        'change_percent': 12.4,
      });

      expect(m.total, 742);
      expect(m.inPeriod, 96);
      expect(m.changePercent, 12.4);
    });

    test('нет изменения — null, а не ноль', () {
      // Ноль читается как «не изменилось», null — как «сравнивать не с чем».
      // На экране это разные подписи.
      final m = AnalyticsMetric.fromJson(<String, dynamic>{'total': 5});
      expect(m.changePercent, isNull);
      expect(m.inPeriod, 0);
    });

    test('целые приходят числом с точкой и не теряют значение', () {
      final m = AnalyticsMetric.fromJson(<String, dynamic>{
        'total': 742.0,
        'in_period': 96.0,
      });
      expect(m.total, 742);
      expect(m.inPeriod, 96);
    });

    test('точка ряда разбирается', () {
      final p = TrendPoint.fromJson(<String, dynamic>{
        'date': '2026-06-01',
        'count': 17,
        'avg_rating': 4.6,
      });

      expect(p.date, DateTime(2026, 6, 1));
      expect(p.count, 17);
      expect(p.avgRating, 4.6);
    });

    test('пустая точка ряда — ноль наблюдений, а не пропуск', () {
      final p = TrendPoint.fromJson(<String, dynamic>{'date': '2026-06-02'});
      expect(p.count, 0);
      expect(p.avgRating, isNull);
    });
  });

  group('Заведение в кабинете партнёра', () {
    Map<String, dynamic> partnerRow() => <String, dynamic>{
          'id': '11111111-1111-4111-8111-111111111111',
          'name': 'Васильки',
          'status': 'active',
          'categories': ['Ресторан'],
          'cuisines': ['Народная'],
          'created_at': '2026-04-01T09:00:00.000Z',
          'updated_at': '2026-06-01T09:00:00.000Z',
          'view_count': 140,
          'favorite_count': 3,
          'review_count': 12,
          'average_rating': 4.5,
        };

    test('строка ответа разбирается целиком', () {
      final e = PartnerEstablishment.fromJson(partnerRow());

      expect(e.name, 'Васильки');
      expect(e.categories, ['Ресторан']);
      expect(e.cuisineTypes, ['Народная']);
      expect(e.stats.views, 140);
      expect(e.stats.favorites, 3);
      expect(e.stats.reviews, 12);
      expect(e.stats.averageRating, 4.5);
    });

    test('счётчики приходят строками и разбираются', () {
      // Агрегаты в SQL считаются через COUNT — node-pg отдаёт bigint строкой.
      final row = partnerRow()
        ..['view_count'] = '140'
        ..['review_count'] = '12'
        ..['average_rating'] = '4.50';

      final e = PartnerEstablishment.fromJson(row);
      expect(e.stats.views, 140);
      expect(e.stats.reviews, 12);
      expect(e.stats.averageRating, 4.5);
    });

    test('ГРАНИЦА: без имени карточка кабинета собирается безымянной', () {
      // Фиксация цены, а не одобрение. Пустое имя рисуется как пустое место
      // в списке заведений партнёра — выглядит как проблема вёрстки, а не
      // как потерянное поле.
      final row = Map<String, dynamic>.from(partnerRow())..remove('name');
      final e = PartnerEstablishment.fromJson(row);
      expect(e.name, isEmpty);
    });

    test('устаревшие имена полей категорий тоже читаются', () {
      final row = Map<String, dynamic>.from(partnerRow())
        ..remove('categories')
        ..remove('cuisines')
        ..['category'] = ['Бар']
        ..['cuisine_type'] = ['Авторская'];

      final e = PartnerEstablishment.fromJson(row);
      expect(e.categories, ['Бар']);
      expect(e.cuisineTypes, ['Авторская']);
    });
  });
}
