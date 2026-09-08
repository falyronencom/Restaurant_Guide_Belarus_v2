import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/admin_review_item.dart';
import 'package:restaurant_guide_admin_web/providers/admin_reviews_provider.dart';
import 'package:restaurant_guide_admin_web/providers/auth_provider.dart';
import 'package:restaurant_guide_admin_web/screens/reviews/reviews_management_screen.dart';
import 'package:restaurant_guide_admin_web/services/admin_review_service.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_pagination.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_column_message.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_error_toast.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_skeleton.dart';

import '../helpers/stub_auth.dart';

// «Отзывы» — кадр 07. До этапа 5 у экрана не было ни одного теста.
//
// Проверяются обещания разбора: статус отзыва назван словом и цветом канона,
// панель озаглавлена заведением, ответ партнёра датирован, а карточка фактов
// отвечает на главный вопрос — сколько этот отзыв весит в оценке заведения.

class _FakeAdminReviewService implements AdminReviewService {
  Completer<AdminReviewListResponse> response =
      Completer<AdminReviewListResponse>();

  int listCalls = 0;

  @override
  Future<AdminReviewListResponse> getReviews({
    int page = 1,
    int perPage = 20,
    String? status,
    int? rating,
    String? search,
    String? sort,
    DateTime? from,
    DateTime? to,
  }) {
    listCalls++;
    return response.future;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

AdminReviewItem _review({
  String id = 'r1',
  int rating = 2,
  String? content = 'Драники падалі халоднымі',
  String? authorName = 'Марына К.',
  String? authorEmail = 'marina.k@gmail.com',
  String? establishmentName = 'Кухмістр',
  String? establishmentCity = 'Минск',
  bool isVisible = true,
  bool isDeleted = false,
  bool isEdited = false,
  String? partnerResponse,
  DateTime? partnerResponseAt,
  double? establishmentAverageRating = 4.1,
  int? establishmentReviewCount = 187,
  int? authorReviewCount = 4,
  double? authorAverageRating = 3.8,
}) =>
    AdminReviewItem(
      id: id,
      rating: rating,
      content: content,
      authorName: authorName,
      authorEmail: authorEmail,
      establishmentName: establishmentName,
      establishmentCity: establishmentCity,
      isVisible: isVisible,
      isDeleted: isDeleted,
      isEdited: isEdited,
      hasPartnerResponse: partnerResponse != null,
      partnerResponse: partnerResponse,
      partnerResponseAt: partnerResponseAt,
      createdAt: DateTime.utc(2026, 8, 12, 16, 24),
      establishmentAverageRating: establishmentAverageRating,
      establishmentReviewCount: establishmentReviewCount,
      authorReviewCount: authorReviewCount,
      authorAverageRating: authorAverageRating,
    );

void main() {
  /// Окно 1440x820 — размер кадра: колонка 420 плюс панель разбора.
  ///
  /// [viewer] — вошёл просмотрщик: экран читает роль из `AuthProvider`,
  /// поэтому стенд обязан его предоставить.
  Future<_FakeAdminReviewService> pumpScreen(
    WidgetTester tester, {
    bool viewer = false,
  }) async {
    final fake = _FakeAdminReviewService();

    tester.view.physicalSize = const Size(1440, 820);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<AdminReviewsProvider>(
            create: (_) => AdminReviewsProvider(service: fake),
          ),
          ChangeNotifierProvider<AuthProvider>(
            create: (_) =>
                viewer ? StubAuthProvider.viewer() : StubAuthProvider.admin(),
          ),
        ],
        child: MaterialApp(
          theme: AppTheme.lightTheme,
          home: const Scaffold(body: ReviewsManagementScreen()),
        ),
      ),
    );
    await tester.pump();

    return fake;
  }

  Future<void> settle(
    WidgetTester tester,
    _FakeAdminReviewService fake, {
    required List<AdminReviewItem> reviews,
    int? total,
    int hidden = 0,
    double? averageRating,
    int pages = 1,
  }) async {
    fake.response.complete(
      AdminReviewListResponse(
        reviews: reviews,
        total: total ?? reviews.length,
        hidden: hidden,
        averageRating: averageRating,
        page: 1,
        pages: pages,
      ),
    );
    fake.response = Completer<AdminReviewListResponse>();
    await tester.pump();
    await tester.pump();
  }

  group('Состояния', () {
    testWidgets('первая загрузка — скелетон, а не крутилка', (tester) async {
      await pumpScreen(tester);

      expect(find.byType(SkeletonBlock), findsWidgets);
      expect(find.byType(CircularProgressIndicator), findsNothing);
    });

    testWidgets('ошибка — карточка канона', (tester) async {
      final fake = await pumpScreen(tester);
      fake.response.completeError(Exception('503'));
      await tester.pump();
      await tester.pump();

      expect(find.byType(AdminColumnMessage), findsOneWidget);
      expect(find.text('Отзывы не загрузились'), findsOneWidget);
    });

    testWidgets('неудача обновления при непустом списке говорит тостом',
        (tester) async {
      final fake = await pumpScreen(tester);
      await settle(
        tester,
        fake,
        reviews: <AdminReviewItem>[_review()],
        total: 40,
        pages: 2,
      );

      tester
          .element(find.byType(ReviewsManagementScreen))
          .read<AdminReviewsProvider>()
          .loadReviews(page: 2);
      fake.response.completeError(Exception('503'));
      fake.response = Completer<AdminReviewListResponse>();
      await tester.pump();
      await tester.pump();
      await tester.pump();

      // Сообщение в колонке заняло бы её целиком и снесло бы уже показанные
      // строки, поэтому его нет; но молчать нельзя — особенно после действия,
      // которое само по себе прошло.
      expect(find.byType(AdminColumnMessage), findsNothing);
      expect(find.byType(AdminErrorToast), findsOneWidget);
      expect(find.text('Список не обновился'), findsOneWidget);
      // Полоса номеров остаётся: без неё уйти с непрогрузившейся страницы
      // нечем.
      expect(find.byType(AdminPagination), findsOneWidget);
    });

    testWidgets('пусто без фильтров — раздел, а не «нет данных»',
        (tester) async {
      final fake = await pumpScreen(tester);
      await settle(tester, fake, reviews: <AdminReviewItem>[]);

      expect(find.byType(AdminColumnMessage), findsOneWidget);
      expect(find.text('Отзывов пока нет'), findsOneWidget);
    });

    testWidgets('футер виден и на единственной странице', (tester) async {
      final fake = await pumpScreen(tester);
      await settle(tester, fake, reviews: <AdminReviewItem>[_review()]);

      expect(find.byType(AdminPagination), findsOneWidget);
      expect(find.textContaining('Показано'), findsOneWidget);
    });
  });

  group('Шапка', () {
    testWidgets('подпись собирает счётчик, скрытые и среднюю', (tester) async {
      final fake = await pumpScreen(tester);
      await settle(
        tester,
        fake,
        reviews: <AdminReviewItem>[_review()],
        total: 1240,
        hidden: 12,
        averageRating: 4.3,
      );

      // Разделитель разрядов у русской локали — НЕРАЗРЫВНЫЙ пробел
      // (U+00A0), а не обычный: `find.text('1 240 …')` с обычным не совпал бы
      // ни с чем, и тест «не нашёл виджет» читался бы как отсутствие подписи.
      expect(
        find.text('1 240 отзывов · 12 скрыто · средний рейтинг 4,3'),
        findsOneWidget,
      );
    });

    testWidgets('нечего сказать — не говорим', (tester) async {
      final fake = await pumpScreen(tester);
      await settle(
        tester,
        fake,
        reviews: <AdminReviewItem>[_review()],
        total: 5,
      );

      // Ни «0 скрыто», ни «средний рейтинг 0,0»: первое — шум, второе — ложь.
      expect(find.text('5 отзывов'), findsOneWidget);
      expect(find.textContaining('скрыто'), findsNothing);
      expect(find.textContaining('средний рейтинг'), findsNothing);
    });
  });

  group('Сброс поиска', () {
    testWidgets('чистит и фильтр, и текст в поле шапки', (tester) async {
      final fake = await pumpScreen(tester);
      await settle(tester, fake, reviews: <AdminReviewItem>[_review()]);

      await tester.enterText(find.byType(TextField), 'холодный');
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await settle(tester, fake, reviews: <AdminReviewItem>[]);

      expect(find.textContaining('поиск «холодный»'), findsOneWidget);

      // Сброс из сообщения пустой выборки: провайдер и поле обязаны
      // очиститься вместе, иначе шапка продолжает показывать запрос,
      // которого в выборке уже нет.
      final callsBeforeReset = fake.listCalls;
      await tester.tap(find.text('Сбросить фильтры'));
      await settle(tester, fake, reviews: <AdminReviewItem>[_review()]);

      final field = tester.widget<TextField>(find.byType(TextField));
      expect(field.controller?.text, isEmpty);
      // Один запрос, а не три: три отдельных сеттера отправили бы два первых
      // ещё со старым поиском, и победил бы ответивший последним.
      expect(fake.listCalls - callsBeforeReset, 1);
      final provider = tester
          .element(find.byType(ReviewsManagementScreen))
          .read<AdminReviewsProvider>();
      expect(provider.searchQuery, isEmpty);
    });
  });

  group('Карточка списка', () {
    testWidgets('скрытый получает disclaimer-пару, а не янтарный',
        (tester) async {
      final fake = await pumpScreen(tester);
      await settle(tester, fake, reviews: <AdminReviewItem>[
        _review(isVisible: false),
      ]);

      final chip = tester.widget<Container>(
        find
            .ancestor(of: find.text('скрыт'), matching: find.byType(Container))
            .first,
      );
      expect(
        (chip.decoration! as BoxDecoration).color,
        AppTheme.disclaimerBg,
      );
      expect(
        tester.widget<Text>(find.text('скрыт')).style?.color,
        AppTheme.disclaimerText,
      );
    });

    testWidgets('удалённый — зачёркнутое имя и красный чип', (tester) async {
      final fake = await pumpScreen(tester);
      await settle(tester, fake, reviews: <AdminReviewItem>[
        _review(isDeleted: true),
      ]);

      expect(
        tester.widget<Text>(find.text('Марына К.')).style?.decoration,
        TextDecoration.lineThrough,
      );
      expect(
        tester.widget<Text>(find.text('удалён')).style?.color,
        AppTheme.errorRed,
      );
    });

    testWidgets('без имени показывается адрес — моноширинным', (tester) async {
      final fake = await pumpScreen(tester);
      await settle(tester, fake, reviews: <AdminReviewItem>[
        _review(authorName: null, authorEmail: 'anon4471@tut.by'),
      ]);

      final email = tester.widget<Text>(find.text('anon4471@tut.by').first);
      // Величина техническая, и шрифт отличает её от имени раньше, чем
      // прочтёшь.
      expect(email.style?.fontFamily, contains('JetBrainsMono'));
    });

    testWidgets('ответ партнёра помечен в карточке', (tester) async {
      final fake = await pumpScreen(tester);
      await settle(tester, fake, reviews: <AdminReviewItem>[
        _review(partnerResponse: 'Прабачце'),
      ]);

      expect(find.text('партнёр ответил'), findsOneWidget);
    });
  });

  group('Панель разбора', () {
    Future<void> open(
      WidgetTester tester,
      AdminReviewItem review, {
      bool viewer = false,
    }) async {
      final fake = await pumpScreen(tester, viewer: viewer);
      await settle(tester, fake, reviews: <AdminReviewItem>[review]);
      await tester.tap(find.text('Марына К.').first);
      await tester.pump();
    }

    testWidgets('озаглавлена заведением, а не «Деталями отзыва»',
        (tester) async {
      await open(tester, _review());

      expect(find.text('Детали отзыва'), findsNothing);
      final heading = tester.widget<Text>(find.text('Кухмістр').last);
      // Unbounded 30 — заголовок крупной секции канона.
      expect(heading.style?.fontSize, 30);
      expect(find.textContaining('отзыв от 12 августа'), findsOneWidget);
      expect(find.text('виден в приложении'), findsOneWidget);
    });

    testWidgets('ответ партнёра датирован — дата приходила и раньше',
        (tester) async {
      await open(
        tester,
        _review(
          partnerResponse: 'Прабачце за чаканне',
          partnerResponseAt: DateTime.utc(2026, 8, 13, 7, 2),
        ),
      );

      expect(find.text('ОТВЕТ ПАРТНЁРА'), findsOneWidget);
      final local = DateTime.utc(2026, 8, 13, 7, 2).toLocal();
      final stamp =
          '${local.day.toString().padLeft(2, '0')}.08.2026 '
          '${local.hour.toString().padLeft(2, '0')}:02';
      expect(find.text(stamp), findsOneWidget);
    });

    testWidgets('карточка фактов взвешивает отзыв', (tester) async {
      await open(tester, _review());

      expect(find.text('4 · средний 3,8'), findsOneWidget);
      expect(find.text('4,1 из 187 отзывов'), findsOneWidget);
      // 4,1 из 187 без двойки — это 4,1113, то есть те же 4,1 на одном знаке.
      // Печатать исходное число второй раз значит не ответить на вопрос.
      expect(find.text('без этого отзыва оценка та же'), findsOneWidget);
      // Механизма жалоб в модели данных нет — строки о них тоже нет.
      expect(find.textContaining('жалоб'), findsNothing);
    });

    testWidgets('совпавшая оценка называется словами, а не повтором числа',
        (tester) async {
      // Заметный случай: единица из пяти отзывов со средней 3,0.
      await open(
        tester,
        _review(
          rating: 1,
          establishmentAverageRating: 3.0,
          establishmentReviewCount: 5,
        ),
      );
      expect(find.text('без этого отзыва 3,5'), findsOneWidget);
    });

    testWidgets('у скрытого «без этого отзыва» не показывается вовсе',
        (tester) async {
      // Скрытый уже вне агрегата — вычитать его оттуда, где его нет, значит
      // получить число из ниоткуда.
      await open(tester, _review(isVisible: false));

      expect(find.textContaining('без этого отзыва'), findsNothing);
      expect(find.text('4,1 из 187 отзывов'), findsOneWidget);
    });

    testWidgets('нет данных — так и сказано, без выдуманных нулей',
        (tester) async {
      await open(
        tester,
        _review(
          authorReviewCount: null,
          authorAverageRating: null,
          establishmentAverageRating: null,
          establishmentReviewCount: null,
        ),
      );

      expect(find.text('нет данных'), findsNWidgets(2));
      expect(find.textContaining('без этого отзыва'), findsNothing);
    });

    testWidgets('кнопки канона: контурная брендовая и заливка ошибки',
        (tester) async {
      await open(tester, _review());

      expect(find.text('Скрыть отзыв'), findsOneWidget);
      expect(find.text('Удалить'), findsOneWidget);
      // Янтарный #F57F17 был внеканонным — его на экране больше нет.
      final painted = tester
          .widgetList<Container>(find.byType(Container))
          .map((c) => c.decoration)
          .whereType<BoxDecoration>()
          .map((d) => d.color)
          .toSet();
      expect(painted.contains(const Color(0xFFF57F17)), isFalse);
    });

    testWidgets('у удалённого действий нет — возвращать нечего',
        (tester) async {
      await open(tester, _review(isDeleted: true));

      expect(find.text('Скрыть отзыв'), findsNothing);
      expect(find.text('Удалить'), findsNothing);
      expect(find.text('Отзыв удалён — вернуть его нельзя'), findsOneWidget);
    });

    testWidgets('роль «только просмотр»: отзыв читается, действий нет',
        (tester) async {
      // Сервер ответил бы просмотрщику 403; кнопка, обещающая то, что не
      // выполнится, читается как поломка — её нет вовсе.
      await open(tester, _review(), viewer: true);

      expect(find.text('Скрыть отзыв'), findsNothing);
      expect(find.text('Удалить'), findsNothing);
      // Сам разбор на месте: панель озаглавлена заведением.
      expect(find.text('Кухмістр'), findsWidgets);
    });

    testWidgets('диалог скрытия предупреждает о пересчёте оценки',
        (tester) async {
      await open(tester, _review());

      await tester.tap(find.text('Скрыть отзыв'));
      await tester.pumpAndSettle();

      // Скрытие исключает отзыв из рейтинга ровно так же, как удаление:
      // модератор, скрывающий единицу, поднимает публичную оценку заведения.
      // Прежний текст обещал только исчезновение из приложения.
      expect(find.textContaining('оценка заведения будет пересчитана'),
          findsOneWidget);
      // И что это обратимо — иначе предупреждение читается страшнее, чем есть.
      expect(find.textContaining('вернётся вместе с ним'), findsOneWidget);
    });

    testWidgets('поле причины переживает закрытие диалога', (tester) async {
      await open(tester, _review());

      await tester.tap(find.text('Удалить'));
      await tester.pumpAndSettle();

      // Тронуть поле обязательно: без единого касания контроллер после
      // закрытия не перестраивается, и дефект не проявляется вовсе.
      await tester.enterText(find.byType(TextField).last, 'оскорбления');
      await tester.pump();

      await tester.tap(find.text('Отмена'));
      // Не pump(), а pumpAndSettle: контроллер, освобождённый на попе
      // маршрута, ронял «used after being disposed» ИМЕННО на кадрах
      // уезжающей анимации, а один кадр до них не доходит.
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
    });

    testWidgets('причина доезжает до провайдера', (tester) async {
      await open(tester, _review());

      await tester.tap(find.text('Удалить'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField).last, '  оскорбления  ');
      await tester.tap(find.text('Удалить').last);
      await tester.pumpAndSettle();

      final provider = tester
          .element(find.byType(ReviewsManagementScreen))
          .read<AdminReviewsProvider>();
      expect(provider.isSubmitting || provider.submitError != null, isTrue);
    });

    testWidgets('скрытый предлагает показать, а не скрыть', (tester) async {
      await open(tester, _review(isVisible: false));

      expect(find.text('Показать отзыв'), findsOneWidget);
      expect(find.text('скрыт от посетителей'), findsOneWidget);
    });
  });
}
