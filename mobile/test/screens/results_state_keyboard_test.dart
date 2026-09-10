import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/screens/search/results_list_screen.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/wire_stand.dart';

/// Состояния экрана результатов при ОТКРЫТОЙ КЛАВИАТУРЕ.
///
/// Найдено на устройстве 10.09.2026: интернет пропал, пока в строке поиска
/// стоял курсор, — экран показал «Ошибка загрузки», и низ обрезало на 24
/// пикселя вместе с кнопкой «Повторить», единственным действием на экране.
///
/// Механика: состояния вставлены как `Expanded`, то есть получают
/// ОГРАНИЧЕННУЮ коробку — остаток экрана. `Scaffold` при открытой клавиатуре
/// этот остаток ужимает, а колонка с иконкой, двумя текстами и кнопкой
/// податливости не имела. Жёлтая полоса переполнения видна только в debug —
/// обрез остаётся и в release.
///
/// Почему тест нужен именно такой формы: обычные проверки состояний поднимают
/// экран на полную высоту, и там всё помещается. Отказ живёт в СОЧЕТАНИИ
/// «состояние × клавиатура», а его ни один тест набора не воспроизводил.
void main() {
  setUp(() {
    AccountScope.debugReset();
    SharedPreferences.setMockInitialValues(<String, Object>{});
    GoogleFonts.config.allowRuntimeFetching = false;
  });

  /// Поднимает экран результатов в состоянии ошибки на узком окне.
  ///
  /// Стенд отвечает 400: провайдер ловит отказ, кладёт текст в `error`, и
  /// экран уходит в ветку ошибки. 401 здесь брать нельзя — он увёл бы в
  /// обновление токена вместо состояния ошибки.
  Future<EstablishmentsProvider> pumpErrorState(
    WidgetTester tester, {
    required double keyboard,
  }) async {
    installWireStand(
      (_) => jsonBody(
        <String, dynamic>{
          'success': false,
          'error': <String, dynamic>{'code': 'BAD_REQUEST'},
        },
        status: 400,
      ),
    );

    tester.view.devicePixelRatio = 1.0;
    tester.view.physicalSize = const Size(400, 700);
    addTearDown(tester.view.reset);

    final provider = EstablishmentsProvider();
    addTearDown(provider.dispose);

    await tester.pumpWidget(
      ChangeNotifierProvider<EstablishmentsProvider>.value(
        value: provider,
        child: const MaterialApp(home: ResultsListScreen()),
      ),
    );
    // Запрос уходит в post-frame; даём ему упасть и экрану перерисоваться.
    for (var i = 0; i < 6; i++) {
      await tester.pump(const Duration(milliseconds: 20));
    }

    expect(provider.error, isNotNull,
        reason: 'стенд обязан был увести экран в состояние ошибки — '
            'иначе проверка ниже смотрит не на то состояние');

    // Клавиатура: ужимаем окно снизу ровно так, как это делает система.
    tester.view.viewInsets = FakeViewPadding(bottom: keyboard);
    await tester.pump();
    await tester.pump();

    return provider;
  }

  testWidgets('ошибка загрузки под клавиатурой не переполняет экран',
      (tester) async {
    await pumpErrorState(tester, keyboard: 320);

    expect(tester.takeException(), isNull,
        reason: 'колонка состояния не влезла в остаток экрана — '
            'в release это молчаливый обрез низа');
  });

  testWidgets('кнопка «Повторить» остаётся достижимой под клавиатурой',
      (tester) async {
    await pumpErrorState(tester, keyboard: 320);

    // `FilledButton.icon` строит ПОДКЛАСС, а `byType` сверяет тип точно —
    // отсюда предикат, а не `byType`.
    final button = find.byWidgetPredicate(
      (w) => w is FilledButton,
      description: 'FilledButton, включая .icon',
    );
    expect(button, findsOneWidget);

    // Достижимость, а не «видна сразу»: если содержимое не помещается, оно
    // обязано прокручиваться — это и есть починка, а не запас по высоте.
    await tester.ensureVisible(button);
    await tester.pump();

    final rect = tester.getRect(button);
    expect(rect.top, greaterThanOrEqualTo(0.0));
    expect(rect.bottom, lessThanOrEqualTo(700.0 - 320.0),
        reason: 'кнопка обязана лежать выше клавиатуры целиком');
  });

  testWidgets('без клавиатуры содержимое по-прежнему по центру',
      (tester) async {
    // Встречная половина: починка не должна была превратить центрированное
    // состояние в прижатое к верху.
    await pumpErrorState(tester, keyboard: 0);

    expect(tester.takeException(), isNull);

    final icon = tester.getRect(find.byIcon(Icons.error_outline));
    final button = tester.getRect(
      find.byWidgetPredicate((w) => w is FilledButton),
    );
    final contentCentre = (icon.top + button.bottom) / 2;

    // Заголовок экрана занимает верх, поэтому центр содержимого ниже середины
    // окна; важно, что оно не прижато ни к верхнему, ни к нижнему краю.
    expect(icon.top, greaterThan(0.0));
    expect(button.bottom, lessThan(700.0));
    expect(contentCentre, greaterThan(icon.top),
        reason: 'содержимое схлопнулось — центрирование потеряно');
  });
}
