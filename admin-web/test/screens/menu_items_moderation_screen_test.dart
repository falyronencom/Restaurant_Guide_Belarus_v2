import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/flagged_menu_item.dart';
import 'package:restaurant_guide_admin_web/providers/auth_provider.dart';
import 'package:restaurant_guide_admin_web/providers/badges_provider.dart';
import 'package:restaurant_guide_admin_web/providers/menu_items_moderation_provider.dart';
import 'package:restaurant_guide_admin_web/screens/menu_items/menu_items_moderation_screen.dart';
import 'package:restaurant_guide_admin_web/services/admin_menu_item_service.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_pagination.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_screen_header.dart';
import 'package:restaurant_guide_admin_web/widgets/menu_items/flagged_menu_items_list_panel.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_skeleton.dart';

import '../helpers/stub_auth.dart';

/// Экран «Позиции меню» по кадру 03.
///
/// Проверяется то, что легко разъезжается молча: подпись шапки (она называет
/// область выборки и обязана описывать ЗАГРУЖЕННОЕ окно), состав карточки
/// очереди и геометрия — замером, а не на глаз.

class _FakeService implements AdminMenuItemService {
  FlaggedMenuItemsResponse response = _response();
  Completer<FlaggedMenuItemsResponse>? gate;
  Object? error;

  @override
  Future<FlaggedMenuItemsResponse> getFlaggedItems({
    int page = 1,
    int perPage = 20,
    String? reason,
    String? visibility,
    String? city,
    String? search,
  }) {
    if (error != null) return Future<FlaggedMenuItemsResponse>.error(error!);
    final pending = gate;
    if (pending != null) return pending.future;
    return Future<FlaggedMenuItemsResponse>.value(response);
  }

  Object? actionError;

  @override
  Future<Map<String, dynamic>> hideItem({
    required String menuItemId,
    required String reason,
  }) async {
    if (actionError != null) throw actionError!;
    return <String, dynamic>{};
  }

  @override
  Future<Map<String, dynamic>> unhideItem(String menuItemId) async =>
      <String, dynamic>{};

  @override
  Future<Map<String, dynamic>> dismissFlag(String menuItemId) async =>
      <String, dynamic>{};
}

class _StubBadges extends BadgesProvider {
  @override
  Future<void> load() async {}
}

// Стаб авторизации общий для стендов: `test/helpers/stub_auth.dart`.

FlaggedMenuItem _item({
  String id = '1',
  String name = 'Драники з мачанкай',
  String venue = 'Кухмістр',
  String? city = 'Минск',
  String status = 'active',
  bool hidden = false,
  String reason = 'price_above_threshold',
}) {
  return FlaggedMenuItem(
    id: id,
    establishmentId: 'est-$id',
    mediaId: 'media-$id',
    itemName: name,
    priceByn: 1450,
    categoryRaw: 'Гарачыя стравы',
    confidence: 0.87,
    sanityFlag: <String, dynamic>{
      'reason': reason,
      'details': <String, dynamic>{'price': 1450, 'threshold': 1000},
    },
    isHiddenByAdmin: hidden,
    hiddenReason: hidden ? 'цена проверена вручную' : null,
    createdAt: DateTime(2026, 7, 14, 9, 41),
    establishmentName: venue,
    establishmentCity: city,
    establishmentStatus: status,
    establishmentCategories: const <String>['Ресторан'],
    establishmentCuisines: const <String>['Народная'],
  );
}

FlaggedMenuItemsResponse _response({
  List<FlaggedMenuItem>? items,
  int? total,
  int page = 1,
  int pages = 1,
  int? visible,
  int? hidden,
  List<String> cities = const <String>['Гродно', 'Минск'],
}) {
  final list = items ?? <FlaggedMenuItem>[_item()];
  return FlaggedMenuItemsResponse(
    items: list,
    total: total ?? list.length,
    page: page,
    pages: pages,
    perPage: 20,
    visibleCount: visible ?? list.length,
    hiddenCount: hidden ?? 0,
    cities: cities,
    reasons: const <String>['price_above_threshold', 'low_confidence'],
  );
}

Future<MenuItemsModerationProvider> _pump(
  WidgetTester tester, {
  required _FakeService service,
  Size size = const Size(1440, 820),
  MenuItemVisibility visibility = MenuItemVisibility.visible,
  bool viewer = false,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);

  final provider = MenuItemsModerationProvider(service: service);
  // `.value` не освобождает то, что ему передали, — это делает создатель.
  // Незакрытый `ChangeNotifier` в стенде отчитывается как течь ТЕСТА и
  // маскирует проверяемую.
  addTearDown(provider.dispose);
  if (visibility != MenuItemVisibility.visible) {
    await provider.setVisibility(visibility);
  }

  await tester.pumpWidget(
    MultiProvider(
      providers: [
        ChangeNotifierProvider<MenuItemsModerationProvider>.value(value: provider),
        ChangeNotifierProvider<BadgesProvider>(create: (_) => _StubBadges()),
        // Панель разбора читает роль: просмотрщику действия не рисуются.
        ChangeNotifierProvider<AuthProvider>(
          create: (_) =>
              viewer ? StubAuthProvider.viewer() : StubAuthProvider.admin(),
        ),
      ],
      child: MaterialApp(
        theme: AppTheme.lightTheme,
        home: const Scaffold(body: MenuItemsModerationScreen()),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return provider;
}

void main() {
  group('подпись шапки называет область выборки', () {
    testWidgets('нескрытые: сколько показано и сколько скрыто', (tester) async {
      final service = _FakeService()
        ..response = _response(total: 12, visible: 12, hidden: 8);

      await _pump(tester, service: service);

      // До этого прохода бейдж рейла считал нескрытые, а список показывал и
      // скрытые — разница ничем не объяснялась. Теперь она названа вслух.
      expect(
        find.text('12 позиций с флагом · показаны нескрытые, ещё 8 скрыто'),
        findsOneWidget,
      );
    });

    testWidgets('нескрытые без скрытых: про скрытые не говорится', (tester) async {
      final service = _FakeService()
        ..response = _response(total: 3, visible: 3, hidden: 0);

      await _pump(tester, service: service);

      expect(find.text('3 позиции с флагом · показаны нескрытые'), findsOneWidget);
    });

    testWidgets('скрытые: знаменатель берётся из второй половины счётчиков',
        (tester) async {
      final service = _FakeService()
        ..response = _response(
          items: <FlaggedMenuItem>[_item(hidden: true)],
          total: 8,
          visible: 12,
          hidden: 8,
        );

      // На этом отборе total и ЕСТЬ число скрытых, поэтому «в очереди ещё 12»
      // нельзя вывести из него — только из counts.visible.
      await _pump(tester, service: service, visibility: MenuItemVisibility.hidden);

      expect(
        find.text('8 позиций с флагом · только скрытые, в очереди ещё 12'),
        findsOneWidget,
      );
    });

    testWidgets('пустая выборка под фильтром говорит про фильтр', (tester) async {
      final service = _FakeService()
        ..response = _response(items: <FlaggedMenuItem>[], total: 0, visible: 0, hidden: 0);

      final provider = await _pump(tester, service: service);
      await provider.setCityFilter('Гомель');
      await tester.pumpAndSettle();

      expect(find.text('Под фильтром ничего не нашлось'), findsOneWidget);
    });

    testWidgets('подпись описывает ЗАГРУЖЕННОЕ окно, а не выставленный фильтр',
        (tester) async {
      final service = _FakeService()
        ..response = _response(total: 12, visible: 12, hidden: 8);
      final provider = await _pump(tester, service: service);

      service.error = Exception('500');
      await provider.setVisibility(MenuItemVisibility.hidden);
      await tester.pump();

      // Список на экране прежний — значит и подпись прежняя. Иначе число
      // описывало бы выборку, которой никто не видит.
      expect(
        find.text('12 позиций с флагом · показаны нескрытые, ещё 8 скрыто'),
        findsOneWidget,
      );
      // И о самом сбое сказано вслух: без тоста нажатие фильтра выглядело бы
      // как «ничего не произошло».
      await tester.pump();
      expect(find.text('Список не обновился'), findsOneWidget);
      expect(
        find.textContaining('остались от прошлой загрузки'),
        findsOneWidget,
      );
    });
  });

  group('очередь', () {
    testWidgets('карточка несёт русскую причину, дату и заведение с городом',
        (tester) async {
      await _pump(tester, service: _FakeService());

      expect(find.text('Драники з мачанкай'), findsOneWidget);
      expect(find.text('Кухмістр · Минск'), findsOneWidget);
      expect(find.text('14.07'), findsOneWidget);
      // Код правила на экран модератора не попадает — ни в списке, ни в чипе.
      expect(find.text('Цена выше порога'), findsWidgets);
      expect(find.textContaining('price_above_threshold'), findsNothing);
    });

    testWidgets('состояние заведения подписывается только у неопубликованных',
        (tester) async {
      final service = _FakeService()
        ..response = _response(items: <FlaggedMenuItem>[
          _item(id: '1', status: 'active'),
          _item(id: '2', name: 'Кофе', status: 'suspended'),
        ]);

      await _pump(tester, service: service);

      // «опубликовано» у каждой карточки было бы шумом: очередь и так почти вся
      // из активных. А «приостановлено» меняет цену разбора — этих блюд сейчас
      // никто не видит.
      expect(find.text('приостановлено'), findsOneWidget);
      expect(find.text('опубликовано'), findsNothing);
    });

    testWidgets('скрытая позиция помечена', (tester) async {
      final service = _FakeService()
        ..response = _response(items: <FlaggedMenuItem>[_item(hidden: true)]);

      await _pump(tester, service: service);

      expect(find.text('скрыто'), findsOneWidget);
    });

    testWidgets('первая загрузка показывает скелетон, а не пустоту',
        (tester) async {
      final service = _FakeService()..gate = Completer<FlaggedMenuItemsResponse>();

      await _pump(tester, service: service);

      expect(find.byType(SkeletonBlock), findsWidgets);

      service.gate!.complete(_response());
      await tester.pumpAndSettle();
      expect(find.byType(SkeletonBlock), findsNothing);
    });

    testWidgets('пусто по фильтру предлагает сброс, пусто по существу — нет',
        (tester) async {
      final service = _FakeService()
        ..response = _response(items: <FlaggedMenuItem>[], total: 0, visible: 0, hidden: 0);

      final provider = await _pump(tester, service: service);
      expect(find.text('Очередь разобрана'), findsOneWidget);
      expect(find.text('Сбросить фильтры'), findsNothing);

      await provider.setSearchFilter('драники');
      await tester.pumpAndSettle();

      expect(find.text('Ничего не нашлось'), findsOneWidget);
      expect(find.text('Сбросить фильтры'), findsOneWidget);
    });

    testWidgets('футер страниц есть при строках и исчезает на пустой выборке',
        (tester) async {
      final service = _FakeService()
        ..response = _response(total: 34, pages: 2, visible: 34, hidden: 0);

      final provider = await _pump(tester, service: service);
      expect(find.byType(AdminPagination), findsOneWidget);

      service.response = _response(items: <FlaggedMenuItem>[], total: 0, visible: 0, hidden: 0);
      await provider.refresh();
      await tester.pumpAndSettle();

      // «Показано 1–1 из 0» было бы неправдой на пустой выборке.
      expect(find.byType(AdminPagination), findsNothing);
    });

    testWidgets('до первого ответа виден скелетон, а не «очередь разобрана»',
        (tester) async {
      // Запрос уходит после первого кадра. На этом кадре список пуст, и без
      // защиты экран успевал заявить «Очередь разобрана» — вывод о том, чего
      // ещё никто не проверял.
      final service = _FakeService()..gate = Completer<FlaggedMenuItemsResponse>();
      tester.view.physicalSize = const Size(1440, 820);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);

      final provider = MenuItemsModerationProvider(service: service);
      addTearDown(provider.dispose);
      await tester.pumpWidget(
        MultiProvider(
          providers: [
            ChangeNotifierProvider<MenuItemsModerationProvider>.value(value: provider),
            ChangeNotifierProvider<BadgesProvider>(create: (_) => _StubBadges()),
            ChangeNotifierProvider<AuthProvider>(
              create: (_) => StubAuthProvider.admin(),
            ),
          ],
          child: MaterialApp(
            theme: AppTheme.lightTheme,
            home: const Scaffold(body: MenuItemsModerationScreen()),
          ),
        ),
      );

      // Ровно один кадр, без pumpAndSettle: именно он и был дефектным.
      expect(find.text('Очередь разобрана'), findsNothing);
      expect(find.byType(SkeletonBlock), findsWidgets);

      service.gate!.complete(_response());
      await tester.pumpAndSettle();
    });

    testWidgets('футер считает диапазон по размеру страницы ИЗ ОТВЕТА',
        (tester) async {
      // Сервер зажимает per_page своим потолком. Считая по клиентской
      // константе, футер назвал бы строки, которых на странице нет.
      final service = _FakeService()
        ..response = FlaggedMenuItemsResponse(
          items: List<FlaggedMenuItem>.generate(
            50,
            (i) => _item(id: 'i$i', name: 'Позиция $i'),
          ),
          total: 200,
          page: 2,
          pages: 4,
          perPage: 50,
          visibleCount: 200,
          hiddenCount: 0,
          cities: const <String>['Минск'],
          reasons: const <String>['price_above_threshold'],
        );

      await _pump(tester, service: service);

      expect(find.textContaining('51–100'), findsOneWidget);
    });

    testWidgets('выбранный город остаётся подписью пилюли и при сбое загрузки',
        (tester) async {
      final service = _FakeService();
      final provider = await _pump(tester, service: service);

      service.error = Exception('500');
      await provider.setCityFilter('Барановичи');
      await tester.pumpAndSettle();

      // Список городов остался прежним, фильтр выставлен. Без подстановки
      // пилюля рисуется активной, но подписана «Все города» — то есть врёт.
      expect(find.text('Барановичи'), findsOneWidget);
    });

    testWidgets('ошибка до первой загрузки занимает колонку', (tester) async {
      final service = _FakeService()..error = Exception('500');

      await _pump(tester, service: service);

      expect(find.text('Очередь не загрузилась'), findsOneWidget);
    });
  });

  group('фильтры и обратная связь', () {
    testWidgets('сброс фильтров чистит и поле поиска', (tester) async {
      final service = _FakeService()
        ..response = _response(items: <FlaggedMenuItem>[], total: 0, visible: 0, hidden: 0);
      await _pump(tester, service: service);

      await tester.enterText(find.byType(TextField), 'драники');
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pumpAndSettle();
      expect(find.text('Ничего не нашлось'), findsOneWidget);

      service.response = _response(total: 12, visible: 12, hidden: 0);
      await tester.tap(find.text('Сбросить фильтры'));
      await tester.pumpAndSettle();

      // Список наполнился — значит отбора нет. Слово в поле утверждало бы
      // обратное, и модератор видел бы две правды сразу.
      expect(find.text('драники'), findsNothing);
      expect(find.text('12 позиций с флагом · показаны нескрытые'), findsOneWidget);
    });

    testWidgets('роль «только просмотр»: факты видны, действий нет',
        (tester) async {
      // Сервер ответил бы просмотрщику 403; кнопка, обещающая то, что не
      // выполнится, читается как поломка — её нет вовсе.
      final service = _FakeService();
      final provider = await _pump(tester, service: service, viewer: true);
      provider.selectItem('1');
      await tester.pumpAndSettle();

      expect(find.text('Скрыть позицию'), findsNothing);
      expect(find.text('Снять флаг'), findsNothing);
      // Разбор на месте: позиция названа.
      expect(find.text('Драники з мачанкай'), findsWidgets);
    });

    testWidgets('неудача действия объясняется тостом и называет действие',
        (tester) async {
      final service = _FakeService();
      final provider = await _pump(tester, service: service);
      provider.selectItem('1');
      await tester.pumpAndSettle();

      service.actionError = Exception('500');
      await tester.tap(find.text('Скрыть позицию'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField).last, 'цена подтверждена по фото');
      await tester.pump();
      await tester.tap(find.widgetWithText(FilledButton, 'Скрыть'));
      await tester.pumpAndSettle();

      // Тост показывает ЭКРАН: панель разбора размонтируется вместе с позицией,
      // и её тост остался бы висеть с мёртвым контекстом.
      expect(find.text('Позиция не скрыта'), findsOneWidget);
      expect(find.text('Очередь не изменилась. Попробуйте ещё раз.'), findsOneWidget);
    });
  });

  group('геометрия', () {
    testWidgets('колонка очереди — 420, шапка — 72', (tester) async {
      await _pump(tester, service: _FakeService());

      final column = tester.getRect(find.byType(FlaggedMenuItemsListPanel));
      expect(column.width, 420);

      // Литералы, а не константы виджета: сверка с `AdminScreenHeader.height`
      // была бы сверкой канона с самим собой.
      final header = tester.getRect(find.byType(AdminScreenHeader));
      expect(header.height, 72);
    });

    testWidgets('шапка не переполняется ни на 1440, ни на узком окне',
        (tester) async {
      // Мерить надо тело, а не окно: рейла 260 в стенде нет, и «влезло в 1440»
      // без него ничего не значит. Подписи берутся САМЫЕ ДЛИННЫЕ — выбранные
      // город и причина занимают больше, чем «Все города» / «Все причины».
      for (final width in <double>[1440, 1020]) {
        final errors = <FlutterErrorDetails>[];
        final previous = FlutterError.onError;
        FlutterError.onError = errors.add;

        final service = _FakeService()
          ..response = _response(cities: const <String>['Могилев', 'Новополоцк']);
        final provider = await _pump(
          tester,
          service: service,
          size: Size(width, 820),
        );
        await provider.setCityFilter('Новополоцк');
        await provider.setReasonFilter('price_above_threshold');
        await tester.pumpAndSettle();

        FlutterError.onError = previous;
        // Любая ошибка, а не только переполнение: фильтр по слову «overflowed»
        // пропускал бы упавший виджет и оставался зелёным.
        expect(errors, isEmpty, reason: 'ширина $width');
      }
    });
  });
}
