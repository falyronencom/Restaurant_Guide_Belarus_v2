import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/providers/admin_reviews_provider.dart';
import 'package:restaurant_guide_admin_web/providers/analytics_totals_provider.dart';
import 'package:restaurant_guide_admin_web/providers/approved_provider.dart';
import 'package:restaurant_guide_admin_web/providers/audit_log_provider.dart';
import 'package:restaurant_guide_admin_web/providers/badges_provider.dart';
import 'package:restaurant_guide_admin_web/providers/dashboard_provider.dart';
import 'package:restaurant_guide_admin_web/providers/establishments_analytics_provider.dart';
import 'package:restaurant_guide_admin_web/providers/menu_items_moderation_provider.dart';
import 'package:restaurant_guide_admin_web/providers/moderation_provider.dart';
import 'package:restaurant_guide_admin_web/providers/quality_health_provider.dart';
import 'package:restaurant_guide_admin_web/providers/rejected_provider.dart';
import 'package:restaurant_guide_admin_web/providers/reviews_analytics_provider.dart';
import 'package:restaurant_guide_admin_web/providers/suspended_provider.dart';
import 'package:restaurant_guide_admin_web/providers/users_analytics_provider.dart';
import 'package:restaurant_guide_admin_web/services/account_scope.dart';

/// Сторож реестра сбросов при смене аккаунта.
///
/// **Почему у сквозной проверки должен быть свой сторож.** `AccountScope` —
/// проверка, включаемая не в одном месте, а в конструкторе каждого
/// провайдера. Выключить её можно, не изменив ни строчки вывода прогона:
/// достаточно завести новый провайдер и не написать в нём `register`. Ни
/// один существующий тест не покраснеет, а после выхода из аккаунта экран
/// покажет состояние прежнего оператора.
///
/// Это не гипотеза: пункт реестра отложенных «Очистка провайдеров при
/// выходе» лежал с четырнадцатью провайдерами, а к сентябрю их стало
/// шестнадцать — механизм «добавят провайдер, про сброс забудут» сработал ещё
/// до постройки сброса. Здесь он закрыт: список берётся из реальной проводки
/// `main.dart`, а не дублируется в тесте.
void main() {
  /// Провайдеры уровня приложения, которые ОБЯЗАНЫ регистрировать сброс.
  ///
  /// Живут в `MultiProvider` в `main.dart`, то есть переживают выход из
  /// аккаунта: их состояние принадлежит вошедшему и после смены аккаунта
  /// обязано исчезнуть.
  const mustRegister = <String>{
    'ModerationProvider', // очередь, карточка и вердикты по полям
    'ApprovedProvider', // каталог, поиск, фильтры, выбранная карточка
    'RejectedProvider', // история отказов и выбранная карточка
    'SuspendedProvider', // приостановленные и выбранная карточка
    'DashboardProvider', // сводка и период
    'EstablishmentsAnalyticsProvider', // вкладка аналитики: данные и период
    'UsersAnalyticsProvider', // вкладка аналитики: данные и период
    'ReviewsAnalyticsProvider', // вкладка аналитики: данные и период
    'AnalyticsTotalsProvider', // итоги полосы вкладок
    'AuditLogProvider', // выборка журнала, фильтры, раскрытая строка
    'AdminReviewsProvider', // отзывы, фильтры, выбранный отзыв
    'MenuItemsModerationProvider', // очередь позиций, фильтры, выбор
    'QualityHealthProvider', // снимок здоровья данных
    'BadgesProvider', // счётчики рейла
  };

  /// Регистрация живёт в базовом классе, а не в файле самого провайдера.
  /// Три вкладки аналитики отличаются только запросом; сброс у них общий.
  const registeredViaBase = <String, String>{
    'EstablishmentsAnalyticsProvider': 'analytics_tab_provider',
    'UsersAnalyticsProvider': 'analytics_tab_provider',
    'ReviewsAnalyticsProvider': 'analytics_tab_provider',
  };

  /// Провайдеры уровня приложения, которые сброс НЕ регистрируют, и почему.
  ///
  /// Список намеренно не пуст и намеренно объясняет каждую строку: пустой
  /// список заставил бы будущего исполнителя дописать сюда что угодно, лишь
  /// бы тест позеленел.
  const deliberatelyNotRegistered = <String, String>{
    'AuthProvider':
        'сам вызывает resetAll при выходе, истёкшей сессии и смене '
            'аккаунта — он источник события, а не его подписчик',
  };

  /// Провайдеры из реальной проводки `main.dart`.
  ///
  /// Две формы: `create: (_) => X()` для доменных и `.value(value:
  /// _authProvider)` для провайдера авторизации, которого роутер должен
  /// получить тем же экземпляром.
  Set<String> wiredProviders() {
    final main = File('lib/main.dart').readAsStringSync();
    final created = RegExp(r'create: \(_\) => (\w+Provider)\(')
        .allMatches(main)
        .map((m) => m.group(1)!)
        .toSet();
    if (main.contains('ChangeNotifierProvider.value(value: _authProvider)')) {
      created.add('AuthProvider');
    }
    return created;
  }

  String snake(String name) => name
      .replaceAllMapped(RegExp('(?<=[a-z])[A-Z]'), (m) => '_${m[0]}')
      .toLowerCase();

  group('Состав реестра против состава приложения', () {
    test('каждый провайдер из main.dart либо регистрирует сброс, либо назван',
        () {
      final wired = wiredProviders();

      expect(wired.length, greaterThan(10),
          reason: 'разбор main.dart почти ничего не нашёл — изменилась форма '
              'объявления провайдеров, и сторож перестал что-либо стеречь');

      final classified =
          mustRegister.union(deliberatelyNotRegistered.keys.toSet());
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
      final wired = wiredProviders();

      expect(mustRegister.difference(wired), isEmpty);
      expect(deliberatelyNotRegistered.keys.toSet().difference(wired), isEmpty);
    });

    test('у каждого обязанного вызов register есть в его исходнике', () {
      // Проверка по тексту дополняет поведенческую ниже: она ловит случай,
      // когда провайдер вообще забыли, а не когда вызов оказался в стороне
      // от пути конструктора.
      for (final name in mustRegister) {
        final fileName = registeredViaBase[name] ?? snake(name);
        final file = File('lib/providers/$fileName.dart');
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
      final builders = <String, ChangeNotifier Function()>{
        'ModerationProvider': () => ModerationProvider(),
        'ApprovedProvider': () => ApprovedProvider(),
        'RejectedProvider': () => RejectedProvider(),
        'SuspendedProvider': () => SuspendedProvider(),
        'DashboardProvider': () => DashboardProvider(),
        'EstablishmentsAnalyticsProvider': () =>
            EstablishmentsAnalyticsProvider(),
        'UsersAnalyticsProvider': () => UsersAnalyticsProvider(),
        'ReviewsAnalyticsProvider': () => ReviewsAnalyticsProvider(),
        'AnalyticsTotalsProvider': () => AnalyticsTotalsProvider(),
        'AuditLogProvider': () => AuditLogProvider(),
        'AdminReviewsProvider': () => AdminReviewsProvider(),
        'MenuItemsModerationProvider': () => MenuItemsModerationProvider(),
        'QualityHealthProvider': () => QualityHealthProvider(),
        'BadgesProvider': () => BadgesProvider(),
      };

      expect(builders.keys.toSet(), mustRegister,
          reason: 'список обязанных и список проверяемых разошлись');

      for (final entry in builders.entries) {
        AccountScope.debugReset();
        expect(AccountScope.debugRegisteredCount, 0);
        final provider = entry.value();
        expect(
          AccountScope.debugRegisteredCount,
          1,
          reason: '${entry.key} не зарегистрировал сброс в конструкторе',
        );
        provider.dispose();
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
  });
}
