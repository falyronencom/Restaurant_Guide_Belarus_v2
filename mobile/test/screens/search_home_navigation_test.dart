import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/cities.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/providers/smart_search_provider.dart';
import 'package:restaurant_guide_mobile/screens/search/search_home_screen.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';
import 'package:restaurant_guide_mobile/widgets/smart_search_bar.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/wire_fixtures.dart';
import '../support/wire_stand.dart';

/// Переход с главной на экран результатов: КТО делает запрос.
///
/// Экран результатов запрашивает выдачу сам, в `initState`. Значит обработчики
/// главной обязаны только перенести фразу и перейти — иначе на один переход
/// уходит два запроса. В `_onShowAll` это было исправлено 07.09, а в соседнем
/// `_executeSearch` (стрелка при пустой строке) осталось.
///
/// Почему на ЖИВОМ экране результатов такой тест дефекта бы не поймал: второй
/// запрос глотает защита `if (_isLoading) return` — post-frame колбэк успевает
/// раньше, чем возвращается сеть, и на провод уходит один запрос в обоих
/// случаях. Дефект латентный. Поэтому целевой маршрут здесь подставной: он
/// изолирует обработчик главной, и счётчик запросов становится различающим —
/// один до правки, ноль после.
void main() {
  late EstablishmentsProvider establishments;

  setUp(() {
    AccountScope.debugReset();
    // Город в хранилище: без него post-frame ветка «GPS не дали и города нет»
    // открывает шторку выбора города и перехватывает тап.
    SharedPreferences.setMockInitialValues(
      <String, Object>{BelarusCities.persistenceKey: 'Минск'},
    );
    // Шрифты вшиты в сборку; в тесте гасим попытку сходить за ними в сеть.
    GoogleFonts.config.allowRuntimeFetching = false;
  });

  Future<StubAdapter> pumpHome(WidgetTester tester) async {
    final adapter = installWireStand((_) => jsonBody(searchEnvelope()));

    establishments = EstablishmentsProvider();
    addTearDown(establishments.dispose);
    final smart = SmartSearchProvider();
    addTearDown(smart.dispose);

    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<EstablishmentsProvider>.value(
              value: establishments),
          ChangeNotifierProvider<SmartSearchProvider>.value(value: smart),
        ],
        child: MaterialApp(
          home: const SearchHomeScreen(),
          routes: {
            // Подставной адресат: настоящий экран результатов сам делает
            // запрос и тем самым скрыл бы лишний запрос главной.
            '/search/results': (_) =>
                const Scaffold(body: Center(child: Text('РЕЗУЛЬТАТЫ'))),
          },
        ),
      ),
    );
    // Даём отработать post-frame цепочке (город, отказ геолокации).
    await tester.pump();
    await tester.pump();
    return adapter;
  }

  Finder chevron() => find.descendant(
        of: find.byType(SmartSearchBar),
        matching: find.byIcon(Icons.chevron_right),
      );

  testWidgets('стрелка переходит на результаты, но запроса не делает',
      (tester) async {
    final adapter = await pumpHome(tester);
    final before = adapter.requests.length;

    await tester.tap(chevron());
    // Прокачиваем достаточно, чтобы запрос УСПЕЛ дойти до провода: конвейер
    // Dio асинхронный, и на двух кадрах адаптер ещё не вызван. Иначе счётчик
    // ниже был бы зелёным при вернувшемся запросе, а тест падал бы позже и по
    // другому поводу — на «висящем таймере».
    for (var i = 0; i < 5; i++) {
      await tester.pump(const Duration(milliseconds: 20));
    }

    expect(find.text('РЕЗУЛЬТАТЫ'), findsOneWidget,
        reason: 'переход обязан состояться');
    expect(adapter.requests.length - before, 0,
        reason: 'запрос делает экран результатов, а не главная');

    // Снимаем экран: иначе периодический таймер подсказок в строке поиска
    // останется висеть после теста.
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('стрелка стирает прошлую фразу — дальше просмотр по фильтрам',
      (tester) async {
    // Встречная половина правки. Стрелка появляется только при ПУСТОЙ строке,
    // то есть её смысл — «искать перестали, показывай по фильтрам». Если убрать
    // вместе с запросом и перенос фразы, в провайдере останется прошлый запрос,
    // и экран результатов молча покажет выдачу по нему.
    await pumpHome(tester);
    establishments.setSearchQuery('капучино');
    await tester.pump();

    await tester.tap(chevron());
    await tester.pump();
    await tester.pump();

    expect(establishments.searchQuery, isEmpty,
        reason: 'пустая строка на главной должна обнулить запрос в провайдере');

    await tester.pumpWidget(const SizedBox.shrink());
  });
}
