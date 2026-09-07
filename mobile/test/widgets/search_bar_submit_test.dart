import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/widgets/results_search_bar.dart';
import 'package:restaurant_guide_mobile/widgets/smart_search_bar.dart';

/// Симметрия способов запустить поиск.
///
/// До 07.09.2026 клавиша «Найти» на главной только прятала клавиатуру: искала
/// одна оранжевая кнопка. На экране результатов было наоборот — искала только
/// клавиша, видимой кнопки не было вовсе. Пользователь, привыкший к одному
/// экрану, на втором нажимал впустую.
///
/// Проверяется именно РАВЕНСТВО двух способов и то, что каждый срабатывает
/// РОВНО ОДИН раз: лишний вызов — это лишний запрос к платной модели.
void main() {
  Widget host(Widget child) => MaterialApp(
        home: Scaffold(body: Padding(padding: const EdgeInsets.all(8), child: child)),
      );

  group('Главная: строка умного поиска', () {
    testWidgets('клавиша клавиатуры ищет так же, как оранжевая кнопка',
        (tester) async {
      var submits = 0;
      var chevrons = 0;
      final controller = TextEditingController(text: 'капучино');
      addTearDown(controller.dispose);

      await tester.pumpWidget(host(SmartSearchBar(
        controller: controller,
        onSubmit: () => submits++,
        onChevronTap: () => chevrons++,
      )));

      await tester.showKeyboard(find.byType(TextField));
      await tester.testTextInput.receiveAction(TextInputAction.search);
      await tester.pump();

      expect(submits, 1);
      expect(chevrons, 0);
    });

    testWidgets('кнопка ищет ровно один раз', (tester) async {
      var submits = 0;
      final controller = TextEditingController(text: 'капучино');
      addTearDown(controller.dispose);

      await tester.pumpWidget(host(SmartSearchBar(
        controller: controller,
        onSubmit: () => submits++,
        onChevronTap: () {},
      )));

      await tester.tap(find.byIcon(Icons.search));
      await tester.pump();

      expect(submits, 1);
    });

    testWidgets('клавиша при пустой строке НЕ ищет, а ведёт на просмотр',
        (tester) async {
      // Пустая строка — это просмотр по фильтрам, а не поиск: стрелка ведёт на
      // экран результатов, тратить на это вызов модели незачем.
      var submits = 0;
      var chevrons = 0;
      final controller = TextEditingController(text: '   ');
      addTearDown(controller.dispose);

      await tester.pumpWidget(host(SmartSearchBar(
        controller: controller,
        onSubmit: () => submits++,
        onChevronTap: () => chevrons++,
      )));

      await tester.showKeyboard(find.byType(TextField));
      await tester.testTextInput.receiveAction(TextInputAction.search);
      await tester.pump();

      expect(submits, 0);
      expect(chevrons, 1);
      expect(find.byIcon(Icons.chevron_right), findsOneWidget);
      expect(find.byIcon(Icons.search), findsNothing);
    });

    testWidgets('поле объявляет действие «поиск», а не «готово»',
        (tester) async {
      // Иначе на клавиатуре устройства подпись обещает «Готово» и клавиша
      // читается как «закрыть», хотя теперь она ищет.
      final controller = TextEditingController(text: 'кофе');
      addTearDown(controller.dispose);

      await tester.pumpWidget(host(SmartSearchBar(
        controller: controller,
        onSubmit: () {},
        onChevronTap: () {},
      )));

      final field = tester.widget<TextField>(find.byType(TextField));
      expect(field.textInputAction, TextInputAction.search);
    });
  });

  group('Экран результатов: общая строка', () {
    testWidgets('клавиша и лупа зовут один и тот же колбэк по одному разу',
        (tester) async {
      var submits = 0;
      var backs = 0;
      final controller = TextEditingController(text: 'пицца за 20 рублей');
      addTearDown(controller.dispose);

      await tester.pumpWidget(host(ResultsSearchBar(
        controller: controller,
        onBack: () => backs++,
        onSubmit: () => submits++,
      )));

      await tester.tap(find.byIcon(Icons.search));
      await tester.pump();
      expect(submits, 1);

      await tester.showKeyboard(find.byType(TextField));
      await tester.testTextInput.receiveAction(TextInputAction.search);
      await tester.pump();
      expect(submits, 2);

      expect(backs, 0, reason: 'поиск не должен задевать возврат назад');
    });

    testWidgets('стрелка внутри поля по-прежнему возвращает назад',
        (tester) async {
      // Лупа появилась справа; если бы она перехватывала тапы по всему полю,
      // выход с экрана сломался бы молча.
      var submits = 0;
      var backs = 0;
      final controller = TextEditingController(text: 'пицца');
      addTearDown(controller.dispose);

      await tester.pumpWidget(host(ResultsSearchBar(
        controller: controller,
        onBack: () => backs++,
        onSubmit: () => submits++,
      )));

      await tester.tap(find.byIcon(Icons.chevron_left));
      await tester.pump();

      expect(backs, 1);
      expect(submits, 0);
    });

    testWidgets('поле объявляет действие «поиск»', (tester) async {
      final controller = TextEditingController();
      addTearDown(controller.dispose);

      await tester.pumpWidget(host(ResultsSearchBar(
        controller: controller,
        onBack: () {},
        onSubmit: () {},
      )));

      final field = tester.widget<TextField>(find.byType(TextField));
      expect(field.textInputAction, TextInputAction.search);
    });

    testWidgets('и лупа, и стрелка помещаются в одну строку 64 логических точки',
        (tester) async {
      // Мерим геометрию, а не смотрим глазами: две иконки внутри поля высотой
      // 64 — то место, где макет Figma ломается первым.
      final controller = TextEditingController(text: 'кофе');
      addTearDown(controller.dispose);

      await tester.pumpWidget(host(ResultsSearchBar(
        controller: controller,
        onBack: () {},
        onSubmit: () {},
      )));

      expect(tester.takeException(), isNull);
      final bar = tester.getRect(find.byType(ResultsSearchBar));
      expect(bar.height, 64);
      final back = tester.getRect(find.byIcon(Icons.chevron_left));
      final search = tester.getRect(find.byIcon(Icons.search));
      expect(back.left, greaterThanOrEqualTo(bar.left));
      expect(search.right, lessThanOrEqualTo(bar.right));
      expect(back.right, lessThan(search.left),
          reason: 'стрелка слева, лупа справа — иконки не должны налезать');
    });
  });
}
