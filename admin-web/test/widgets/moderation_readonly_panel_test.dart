import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/establishment.dart';
import 'package:restaurant_guide_admin_web/providers/moderation_provider.dart';
import 'package:restaurant_guide_admin_web/widgets/moderation/definition_grid.dart';
import 'package:restaurant_guide_admin_web/widgets/moderation/moderation_detail_panel.dart';
import 'package:restaurant_guide_admin_web/widgets/moderation/moderation_field_review.dart';

// Режим чтения панели разбора — кадры 11–13. У одобренного заведения решать
// нечего, поэтому строки полей с вердиктами заменены сеткой значений, а имя,
// статус и причины переехали в отдельные блоки. Проверяется то, что при этом
// легко потерять: раскладка сетки, попадание причин в блок и отсутствие
// вердикт-кнопок там, где выносить вердикт не по чему.

EstablishmentDetail _detail({
  String status = 'active',
  String? city = 'Минск',
  Map<String, dynamic>? moderationNotes,
  String? suspendedByName,
  bool partnerDataRedacted = false,
}) {
  return EstablishmentDetail(
    id: 'a41f9c02-1234-5678-9abc-def012345678',
    partnerId: 'p-1',
    name: 'Кухмістр',
    status: status,
    city: city,
    categories: const <String>['Ресторан'],
    cuisines: const <String>['Народная'],
    phone: '+375 29 611-24-80',
    unp: '191482073',
    legalName: 'ООО «Кухмістр Плюс»',
    registrationDocUrl: partnerDataRedacted
        ? null
        : 'https://res.cloudinary.com/test/raw/upload/registration.pdf',
    contactPerson: partnerDataRedacted ? null : 'Иван Контактов',
    moderationNotes: moderationNotes,
    suspendedByName: suspendedByName,
    partnerDataRedacted: partnerDataRedacted,
  );
}

Future<void> _pumpPanel(
  WidgetTester tester, {
  required DetailPanelMode mode,
  EstablishmentDetail? detail,
  Map<String, dynamic>? rejectionNotes,
  Size size = const Size(1440, 820),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);

  await tester.pumpWidget(
    MaterialApp(
      theme: AppTheme.lightTheme,
      home: Scaffold(
        body: ModerationDetailPanel(
          mode: mode,
          detail: detail ?? _detail(),
          selectedId: 'a41f9c02-1234-5678-9abc-def012345678',
          isLoadingDetail: false,
          rejectionNotes: rejectionNotes,
        ),
      ),
    ),
  );
  await tester.pump();
}

void main() {
  group('Сетка определений', () {
    Future<void> pumpGrid(
      WidgetTester tester,
      List<Definition> items,
    ) async {
      tester.view.physicalSize = const Size(1000, 820);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.lightTheme,
          home: Scaffold(body: DefinitionGrid(items: items)),
        ),
      );
      await tester.pump();
    }

    testWidgets('обычные ячейки встают по две в строку', (tester) async {
      await pumpGrid(tester, const <Definition>[
        Definition(label: 'Первая', value: '1'),
        Definition(label: 'Вторая', value: '2'),
      ]);

      // Обе на одной высоте — значит в одной строке.
      expect(
        tester.getRect(find.text('Первая')).top,
        tester.getRect(find.text('Вторая')).top,
      );
      // И в разных колонках.
      expect(
        tester.getRect(find.text('Первая')).left,
        lessThan(tester.getRect(find.text('Вторая')).left),
      );
    });

    testWidgets('широкая ячейка забирает строку целиком', (tester) async {
      await pumpGrid(tester, const <Definition>[
        Definition(label: 'Описание', value: 'Проза', wide: true),
        Definition(label: 'Телефон', value: '+375'),
      ]);

      // Широкая не делит строку с соседкой: следующая ячейка ниже.
      expect(
        tester.getRect(find.text('Телефон')).top,
        greaterThan(tester.getRect(find.text('Описание')).top),
      );

      // И — главное — она действительно ШИРЕ обычной, а не просто стоит
      // одна в строке. Проверка по соседству это пропускала: обёртка из
      // двух Expanded отдавала половину ширины пустышке, и «широкая» ячейка
      // выходила ровно такой же, как рядовая.
      final wide = tester.getRect(find.byType(Container).at(0)).width;
      final normal = tester.getRect(find.byType(Container).at(1)).width;
      expect(wide, greaterThan(normal * 1.8));
    });

    testWidgets('пустое значение называется «не указан», а не прячется',
        (tester) async {
      await pumpGrid(tester, const <Definition>[
        Definition(label: 'Сайт'),
        Definition(label: 'Телефон', value: '   '),
      ]);

      // Пустое поле у одобренного заведения — само по себе сведение.
      expect(find.text('Сайт'), findsOneWidget);
      expect(find.text('не указан'), findsNWidgets(2));
    });

    testWidgets('величина показывается моноширинным', (tester) async {
      await pumpGrid(tester, const <Definition>[
        Definition(label: 'УНП', value: '191482073', mono: true),
        Definition(label: 'Название', value: 'Кухмістр'),
      ]);

      // Семейство именно моноширинное. Сверяем по префиксу, а не по
      // AppTheme.fontMonoFamily: google_fonts регистрирует каждое начертание
      // отдельным семейством, и у веса 500 имя своё — JetBrainsMono_500.
      expect(
        tester.widget<Text>(find.text('191482073')).style?.fontFamily,
        startsWith('JetBrainsMono'),
      );
      // А проза — нет: тип данных различается шрифтом, не цветом.
      expect(
        tester.widget<Text>(find.text('Кухмістр')).style?.fontFamily,
        isNot(startsWith('JetBrainsMono')),
      );
    });
  });

  group('Панель в режиме чтения', () {
    testWidgets('показывает имя и статус словом', (tester) async {
      await _pumpPanel(tester, mode: DetailPanelMode.readonly);

      // Имя встречается дважды и это верно: крупно в шапке панели и ячейкой
      // «Название» в сетке — так же, как нарисовано в кадре 11.
      expect(find.text('Кухмістр'), findsNWidgets(2));
      expect(find.text('опубликовано'), findsOneWidget);
      // Машинного кода на экране модератора быть не должно.
      expect(find.text('active'), findsNothing);
    });

    testWidgets('вердикт-кнопок и нижней панели нет', (tester) async {
      await _pumpPanel(tester, mode: DetailPanelMode.readonly);

      // Решать нечего: заведение уже одобрено.
      expect(find.text('Одобрить заведение'), findsNothing);
      expect(find.text('Отклонить заявку'), findsNothing);
    });

    testWidgets('имя в шапке — дисплейным кеглем канона', (tester) async {
      await _pumpPanel(tester, mode: DetailPanelMode.readonly);

      // Крупный заголовок ровно один: Unbounded 30. Второе вхождение имени —
      // это ячейка сетки кеглем 15, и спутать их нельзя.
      final display = find
          .byWidgetPredicate((w) => w is Text && w.style?.fontSize == 30)
          .evaluate();
      expect(display.length, 1);
      expect(
        (display.first.widget as Text).style?.fontFamily,
        startsWith('Unbounded'),
      );
    });
  });

  group('Блок причин отказа', () {
    testWidgets('собирает причины и считает только заполненные',
        (tester) async {
      await _pumpPanel(
        tester,
        mode: DetailPanelMode.readonly,
        rejectionNotes: <String, dynamic>{
          'address': 'Адрес не совпадает с меткой',
          'photos': 'Нет фото интерьера',
          'unp': '   ',
        },
      );

      expect(find.text('Причины отказа'), findsOneWidget);
      // Пустая причина в счёт не идёт — иначе чип обещал бы работу,
      // которой в списке нет.
      expect(find.text('2 поля'), findsOneWidget);
      expect(find.text('Адрес не совпадает с меткой'), findsOneWidget);
    });

    testWidgets('без причин блок не появляется', (tester) async {
      await _pumpPanel(tester, mode: DetailPanelMode.readonly);
      expect(find.text('Причины отказа'), findsNothing);
    });
  });

  group('Блок причины приостановки', () {
    testWidgets('показывает причину и время', (tester) async {
      await _pumpPanel(
        tester,
        mode: DetailPanelMode.suspended,
        detail: _detail(
          status: 'suspended',
          moderationNotes: <String, dynamic>{
            'suspend_reason': 'Жалобы на санитарное состояние кухни',
            'suspended_at': '2026-08-07T11:40:00.000Z',
          },
        ),
      );

      expect(find.text('Причина приостановки'), findsOneWidget);
      expect(find.text('Жалобы на санитарное состояние кухни'), findsOneWidget);
      expect(find.text('приостановлено'), findsOneWidget);

      // Время — местное, а не UTC. Ожидание считается тем же переводом,
      // поэтому на машине в UTC (как в CI) проверка тавтологична и пройдёт
      // всегда; смысл она имеет там, где разработка и идёт — на UTC+3, где
      // без `.toLocal()` метка уезжает на три часа, а всё после 21:00 ещё и
      // на вчерашнее число.
      final local = DateTime.parse('2026-08-07T11:40:00.000Z').toLocal();
      String two(int n) => n.toString().padLeft(2, '0');
      expect(
        find.textContaining('${two(local.day)}.${two(local.month)}'),
        findsOneWidget,
      );
      expect(
        find.textContaining('${two(local.hour)}:${two(local.minute)}'),
        findsOneWidget,
      );
    });

    testWidgets('без причины блок не появляется', (tester) async {
      await _pumpPanel(
        tester,
        mode: DetailPanelMode.suspended,
        detail: _detail(status: 'suspended'),
      );
      expect(find.text('Причина приостановки'), findsNothing);
    });

    testWidgets('называет автора, когда журнал его знает', (tester) async {
      // Автор приходит из `suspended_by` проекции (последняя запись
      // `suspend` в журнале действий), а не из moderation_notes.
      await _pumpPanel(
        tester,
        mode: DetailPanelMode.suspended,
        detail: _detail(
          status: 'suspended',
          moderationNotes: <String, dynamic>{
            'suspend_reason': 'Жалобы на санитарное состояние кухни',
            'suspended_at': '2026-08-07T11:40:00.000Z',
          },
          suspendedByName: 'Сергей Админов',
        ),
      );

      expect(find.text('Приостановил: Сергей Админов'), findsOneWidget);
    });

    testWidgets('без автора строки нет — выдуманного имени не будет',
        (tester) async {
      await _pumpPanel(
        tester,
        mode: DetailPanelMode.suspended,
        detail: _detail(
          status: 'suspended',
          moderationNotes: <String, dynamic>{
            'suspend_reason': 'Жалобы на санитарное состояние кухни',
            'suspended_at': '2026-08-07T11:40:00.000Z',
          },
        ),
      );

      expect(find.textContaining('Приостановил:'), findsNothing);
    });
  });

  group('Контакты партнёра у просмотрщика', () {
    testWidgets('скрытое названо словом, а не пустой ячейкой', (tester) async {
      // Сервер отдал null не потому, что данных нет, а потому, что вошедший
      // их видеть не должен. Пустая ячейка утверждала бы первое.
      await _pumpPanel(
        tester,
        mode: DetailPanelMode.readonly,
        detail: _detail(partnerDataRedacted: true),
      );

      // Вкладка «Данные»: строка «Регистрация».
      expect(find.text('Скрыто в режиме просмотра'), findsWidgets);
      expect(find.text('registration.pdf'), findsNothing);
    });

    testWidgets('администратору ячейки не подменяются', (tester) async {
      await _pumpPanel(
        tester,
        mode: DetailPanelMode.readonly,
        detail: _detail(),
      );

      expect(find.text('Скрыто в режиме просмотра'), findsNothing);
    });
  });

  // Режим чтения до строк полей не доходит: каждая вкладка возвращает сетку
  // определений раньше. Это и есть причина, по которой у строки поля больше
  // нет ветки «только чтение» — параметр, который её кормил, был недостижим.
  // Тест держит сам инвариант, а не его следствие: пропадёт ранний возврат
  // из вкладки — строки с вердикт-кнопками вылезут на экран, где решать
  // нечего. Соседний тест «вердикт-кнопок и нижней панели нет» проверяет
  // только подписи нижней панели и такую поломку не заметил бы.
  group('Строк полей в режиме чтения нет', () {
    testWidgets('ни на одной из четырёх вкладок', (tester) async {
      await _pumpPanel(tester, mode: DetailPanelMode.readonly);

      for (var i = 0; i < kModerationTabTitles.length; i++) {
        await tester.tap(find.byType(Tab).at(i));
        await tester.pumpAndSettle();

        expect(
          find.byType(ModerationFieldReview),
          findsNothing,
          reason: 'вкладка «${kModerationTabTitles[i]}» показала строку поля',
        );
      }
    });
  });

  // «Ничего не пропало с экрана» в исполняемом виде.
  //
  // Причины отказа раньше показывались в строке поля, теперь — одним блоком
  // над вкладками. Блок перебирает всю карту и подписывает ключ словарём, а
  // незнакомый ключ выводит СЫРЫМ: это ровно тот дефект, ради которого
  // заводится русификация машинных обозначений на экранах модератора.
  //
  // Источник истины по составу ключей — [kModerationTabFields], тот же
  // список, по которому считается прогресс проверки: новое модерируемое поле
  // обязано попасть в него, иначе счётчик вкладки соврёт. Поэтому канон
  // здесь не дублируется списком-копией, как в anti-drift тестах web, где
  // общего источника между целями нет.
  group('Причины отказа: ни один ключ не теряется', () {
    testWidgets('каждый ключ канона подписан по-русски', (tester) async {
      final keys = kModerationTabFields.expand((f) => f).toList();
      final notes = <String, dynamic>{
        for (final key in keys) key: 'причина по полю $key',
      };

      await _pumpPanel(
        tester,
        mode: DetailPanelMode.readonly,
        rejectionNotes: notes,
        // Четырнадцать причин в 820 не помещаются, а панель — Column с
        // Expanded под вкладками: не хватит высоты — будет overflow, а не
        // осмысленный отказ.
        size: const Size(1440, 2200),
      );

      for (final key in keys) {
        expect(
          find.text('причина по полю $key'),
          findsOneWidget,
          reason: 'причина по «$key» не доехала до блока',
        );
        // find.text сверяет data целиком, поэтому подстрока в тексте самой
        // причины сюда не попадает — совпадение означает именно подпись.
        expect(
          find.text(key),
          findsNothing,
          reason: 'ключ «$key» показан модератору сырым: '
              'нет подписи в _fieldLabel',
        );
      }
    });
  });
}
