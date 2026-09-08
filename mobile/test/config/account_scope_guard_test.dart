import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/providers/booking_provider.dart';
import 'package:restaurant_guide_mobile/providers/booking_settings_provider.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/providers/notification_preferences_provider.dart';
import 'package:restaurant_guide_mobile/providers/notification_provider.dart';
import 'package:restaurant_guide_mobile/providers/partner_dashboard_provider.dart';
import 'package:restaurant_guide_mobile/providers/partner_menu_provider.dart';
import 'package:restaurant_guide_mobile/providers/promotion_provider.dart';
import 'package:restaurant_guide_mobile/providers/smart_search_provider.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';

/// Сторож реестра сбросов при смене аккаунта.
///
/// **Почему у сквозной проверки должен быть свой сторож.** `AccountScope` —
/// проверка, включаемая не в одном месте, а в конструкторе каждого
/// провайдера. Выключить её можно, не изменив ни строчки вывода прогона:
/// достаточно завести новый провайдер и не написать в нём `register`. Ни
/// один существующий тест не покраснеет, а после выхода из аккаунта экран
/// покажет данные прежнего владельца.
///
/// Это не гипотеза. 2026-07-30: после выхода из seed-аккаунта и входа через
/// Google личный кабинет показал карточки прежнего аккаунта вместе с
/// бронями, а в бронях — имена и телефоны гостей. Бэкенд скоупит по JWT,
/// утечка была чисто клиентская. Закрыто `1578b65` — этим самым реестром.
///
/// Вопрос брифа аудита к любому сквозному сторожу: *как его выключить, не
/// изменив вывод прогона?* Ответ закрепляется здесь.
void main() {
  /// Провайдеры уровня приложения, которые ОБЯЗАНЫ регистрировать сброс.
  ///
  /// Живут в `MultiProvider` в `main.dart`, то есть переживают выход из
  /// аккаунта: их состояние принадлежит конкретному владельцу и после смены
  /// аккаунта обязано исчезнуть.
  const mustRegister = <String>{
    'EstablishmentsProvider', // избранное
    'PartnerDashboardProvider', // заведения партнёра
    'NotificationProvider', // уведомления и бейдж
    'PromotionProvider', // акции партнёра
    'PartnerMenuProvider', // позиции меню
    'BookingSettingsProvider', // настройки брони
    'BookingProvider', // брони с именами и телефонами гостей
    'NotificationPreferencesProvider', // переключатели пушей
    'SmartSearchProvider', // фраза, её разбор и превью на главной
  };

  /// Провайдеры уровня приложения, которые сброс НЕ регистрируют, и почему.
  ///
  /// Список намеренно не пуст и намеренно объясняет каждую строку: пустой
  /// список заставил бы будущего исполнителя дописать сюда что угодно, лишь
  /// бы тест позеленел.
  const deliberatelyNotRegistered = <String, String>{
    'AuthProvider':
        'сам вызывает resetAll при выходе и смене userId — он источник '
            'события, а не его подписчик',
  };

  group('Состав реестра против состава приложения', () {
    test('каждый провайдер из main.dart либо регистрирует сброс, либо назван',
        () {
      // Список берётся из РЕАЛЬНОЙ проводки, а не дублируется в тесте:
      // дубль разошёлся бы с `main.dart` молча, и сторож стерёг бы себя.
      final main = File('lib/main.dart').readAsStringSync();
      final wired = RegExp(r'create: \(_\) => (\w+Provider)\(')
          .allMatches(main)
          .map((m) => m.group(1)!)
          .toSet();

      expect(wired, isNotEmpty,
          reason: 'разбор main.dart ничего не нашёл — изменилась форма '
              'объявления провайдеров, и сторож перестал что-либо стеречь');

      final classified = mustRegister.union(deliberatelyNotRegistered.keys.toSet());
      final unclassified = wired.difference(classified);

      expect(
        unclassified,
        isEmpty,
        reason: 'провайдер уровня приложения не отнесён ни к обязанным '
            'регистрировать сброс, ни к названным исключениям: $unclassified. '
            'Он переживёт выход из аккаунта, и его состояние увидит следующий '
            'вошедший',
      );
    });

    test('в списке обязанных нет провайдеров, которых нет в приложении', () {
      // Обратное направление: провайдер, выпавший из main.dart, оставил бы в
      // списке мёртвую строку, и сторож продолжил бы отчитываться о нём.
      final main = File('lib/main.dart').readAsStringSync();
      final wired = RegExp(r'create: \(_\) => (\w+Provider)\(')
          .allMatches(main)
          .map((m) => m.group(1)!)
          .toSet();

      expect(mustRegister.difference(wired), isEmpty);
      expect(deliberatelyNotRegistered.keys.toSet().difference(wired), isEmpty);
    });

    test('у каждого обязанного вызов register есть в его исходнике', () {
      // Проверка по тексту дополняет поведенческую ниже: она ловит случай,
      // когда провайдер вообще забыли, а не когда вызов оказался в стороне
      // от пути конструктора.
      for (final name in mustRegister) {
        final file = File('lib/providers/${_snake(name)}.dart');
        expect(file.existsSync(), isTrue,
            reason: 'не найден исходник ${file.path}');
        expect(
          file.readAsStringSync(),
          contains('AccountScope.register('),
          reason: '$name обязан регистрировать сброс при смене аккаунта',
        );
      }
    });
  });

  group('Реестр наполняется на самом деле, а не по тексту', () {
    setUp(AccountScope.debugReset);
    tearDown(AccountScope.debugReset);

    test('конструктор каждого обязанного провайдера добавляет ровно один сброс',
        () {
      // Поведенческая половина сторожа. Текстовая проверка выше зеленеет и
      // тогда, когда `register` есть в файле, но лежит в ветке, куда
      // конструктор не заходит.
      final builders = <String, void Function()>{
        'EstablishmentsProvider': () => EstablishmentsProvider(),
        'PartnerDashboardProvider': () => PartnerDashboardProvider(),
        'NotificationProvider': () => NotificationProvider(),
        'PromotionProvider': () => PromotionProvider(),
        'PartnerMenuProvider': () => PartnerMenuProvider(),
        'BookingSettingsProvider': () => BookingSettingsProvider(),
        'BookingProvider': () => BookingProvider(),
        'NotificationPreferencesProvider': () =>
            NotificationPreferencesProvider(),
        'SmartSearchProvider': () => SmartSearchProvider(),
      };

      expect(builders.keys.toSet(), mustRegister,
          reason: 'список обязанных и список проверяемых разошлись');

      for (final entry in builders.entries) {
        AccountScope.debugReset();
        expect(AccountScope.debugRegisteredCount, 0);
        entry.value();
        expect(
          AccountScope.debugRegisteredCount,
          1,
          reason: '${entry.key} не зарегистрировал сброс в конструкторе',
        );
      }
    });

    test('resetAll вызывает каждый зарегистрированный сброс ровно один раз',
        () {
      var first = 0;
      var second = 0;
      AccountScope.register(() => first++);
      AccountScope.register(() => second++);

      AccountScope.resetAll();

      expect(first, 1);
      expect(second, 1);
    });

    test('сброс доходит до состояния провайдера, а не только до реестра', () {
      // Сквозная проверка на одном провайдере: реестр может быть полон, а
      // сам `resetAccountScope` — ничего не чистить.
      final provider = EstablishmentsProvider();
      addTearDown(provider.dispose);

      expect(provider.favoriteIds, isEmpty);
      provider.toggleFavorite('11111111-1111-4111-8111-111111111111');
      expect(provider.favoriteIds, isNotEmpty,
          reason: 'оптимистичное добавление в избранное не сработало — '
              'дальнейшая проверка сброса ничего не докажет');

      AccountScope.resetAll();

      expect(provider.favoriteIds, isEmpty,
          reason: 'избранное прежнего аккаунта пережило смену пользователя');
      expect(provider.favoriteEstablishments, isEmpty);
    });
  });
}

/// `EstablishmentsProvider` → `establishments_provider`.
String _snake(String className) => className
    .replaceAllMapped(RegExp(r'(?<!^)([A-Z])'), (m) => '_${m.group(1)}')
    .toLowerCase();
