import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/formatters.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/analytics_models.dart';
import 'package:restaurant_guide_admin_web/providers/analytics_totals_provider.dart';
import 'package:restaurant_guide_admin_web/providers/establishments_analytics_provider.dart';
import 'package:restaurant_guide_admin_web/providers/reviews_analytics_provider.dart';
import 'package:restaurant_guide_admin_web/providers/users_analytics_provider.dart';
import 'package:restaurant_guide_admin_web/screens/analytics/analytics_container_screen.dart';
import 'package:restaurant_guide_admin_web/services/analytics_service.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/metric_card.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/period_selector.dart';
import 'package:restaurant_guide_admin_web/widgets/analytics/share_bar.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_skeleton.dart';

/// Подставной сервис.
///
/// Ответы держатся на `Completer`-ах, а не на готовых значениях: загрузку
/// нужно уметь остановить на середине, иначе скелетон не увидеть. Ожидающих
/// запросов может быть несколько подряд — вкладка перечитывается при смене
/// периода, — поэтому каждый вызов кладёт СВОЙ `Completer` в очередь.
class _FakeAnalyticsService implements AnalyticsService {
  final List<Completer<OverviewData>> _overviewQueue =
      <Completer<OverviewData>>[];
  final List<Completer<EstablishmentsAnalyticsData>> _establishmentsQueue =
      <Completer<EstablishmentsAnalyticsData>>[];
  final List<Completer<UsersAnalyticsData>> _usersQueue =
      <Completer<UsersAnalyticsData>>[];
  final List<Completer<ReviewsAnalyticsData>> _reviewsQueue =
      <Completer<ReviewsAnalyticsData>>[];

  int overviewCalls = 0;
  final List<String> establishmentPeriods = <String>[];
  final List<String> userPeriods = <String>[];
  final List<String> reviewPeriods = <String>[];

  @override
  Future<OverviewData> getOverview({
    String period = '30d',
    String? from,
    String? to,
  }) {
    overviewCalls++;
    final completer = Completer<OverviewData>();
    _overviewQueue.add(completer);
    return completer.future;
  }

  @override
  Future<EstablishmentsAnalyticsData> getEstablishmentsAnalytics({
    String period = '30d',
    String? from,
    String? to,
  }) {
    establishmentPeriods.add(period);
    final completer = Completer<EstablishmentsAnalyticsData>();
    _establishmentsQueue.add(completer);
    return completer.future;
  }

  @override
  Future<UsersAnalyticsData> getUsersAnalytics({
    String period = '30d',
    String? from,
    String? to,
  }) {
    userPeriods.add(period);
    final completer = Completer<UsersAnalyticsData>();
    _usersQueue.add(completer);
    return completer.future;
  }

  @override
  Future<ReviewsAnalyticsData> getReviewsAnalytics({
    String period = '30d',
    String? from,
    String? to,
  }) {
    reviewPeriods.add(period);
    final completer = Completer<ReviewsAnalyticsData>();
    _reviewsQueue.add(completer);
    return completer.future;
  }

  /// Отклонить самый ранний неотвеченный запрос.
  void failEstablishments(Object error) {
    _establishmentsQueue.firstWhere((c) => !c.isCompleted).completeError(error);
  }

  /// Ответить на самый ранний неотвеченный запрос.
  void answerOverview(OverviewData data) => _answer(_overviewQueue, data);
  void answerEstablishments(EstablishmentsAnalyticsData data) =>
      _answer(_establishmentsQueue, data);
  void answerUsers(UsersAnalyticsData data) => _answer(_usersQueue, data);
  void answerReviews(ReviewsAnalyticsData data) => _answer(_reviewsQueue, data);

  static void _answer<T>(List<Completer<T>> queue, T data) {
    final pending = queue.firstWhere(
      (c) => !c.isCompleted,
      orElse: () => throw StateError('ответить не на что — запроса не было'),
    );
    pending.complete(data);
  }
}

// ============================================================================
// Данные
// ============================================================================

/// Числа взяты с кадров 08 и 10 — так расхождение с макетом видно прямо здесь.
EstablishmentsAnalyticsData _establishments({
  List<DistributionItem>? statuses,
  List<DistributionItem>? cities,
  List<DistributionItem>? categories,
  int total = 412,
}) =>
    EstablishmentsAnalyticsData(
      creationTimeline: const <TimelinePoint>[
        TimelinePoint(date: '2026-08-08', count: 2),
        TimelinePoint(date: '2026-08-09', count: 5),
      ],
      statusDistribution: statuses ??
          const <DistributionItem>[
            // Порядок нарочно не канонический: бэкенд сортирует по убыванию.
            DistributionItem(label: 'active', count: 365),
            DistributionItem(label: 'rejected', count: 18),
            DistributionItem(label: 'suspended', count: 11),
            DistributionItem(label: 'draft', count: 9),
            DistributionItem(label: 'pending', count: 7),
            DistributionItem(label: 'archived', count: 2),
          ],
      cityDistribution: cities ??
          const <DistributionItem>[
            DistributionItem(label: 'Минск', count: 214),
            DistributionItem(label: 'Гомель', count: 47),
          ],
      categoryDistribution: categories ??
          const <DistributionItem>[
            DistributionItem(label: 'Ресторан', count: 96),
            DistributionItem(label: 'Кофейня', count: 74),
          ],
      total: total,
      active: 365,
      pending: 7,
      newInPeriod: 37,
      changePercent: 18.4,
      aggregation: 'day',
      period: AnalyticsPeriod(
        start: DateTime.utc(2026, 7, 12),
        endExclusive: DateTime.utc(2026, 8, 11),
      ),
    );

UsersAnalyticsData _users({List<DistributionItem>? roles}) => UsersAnalyticsData(
      registrationTimeline: const <TimelinePoint>[
        TimelinePoint(date: '2026-08-08', count: 4),
        TimelinePoint(date: '2026-08-09', count: 9),
      ],
      roleDistribution: roles ??
          const <DistributionItem>[
            DistributionItem(label: 'user', count: 3291),
            DistributionItem(label: 'partner', count: 174),
            DistributionItem(label: 'admin', count: 15),
          ],
      total: 3480,
      newInPeriod: 186,
      changePercent: 12.3,
      aggregation: 'day',
      period: AnalyticsPeriod(
        start: DateTime.utc(2026, 7, 12),
        endExclusive: DateTime.utc(2026, 8, 11),
      ),
    );

ReviewsAnalyticsData _reviews({
  List<RatingDistributionItem>? ratings,
  ResponseStats? response,
}) =>
    ReviewsAnalyticsData(
      reviewTimeline: const <TimelinePoint>[
        TimelinePoint(date: '2026-08-08', count: 12, averageRating: 4.4),
        TimelinePoint(date: '2026-08-09', count: 7, averageRating: 4.1),
      ],
      ratingDistribution: ratings ?? _ratingsFrame09,
      responseStats: response ??
          const ResponseStats(
            totalReviews: 1240,
            totalWithResponse: 287,
            responseRate: 0.2314,
            avgResponseTimeHours: 18.4,
          ),
      total: 1240,
      newInPeriod: 214,
      changePercent: 9.7,
      averageRating: 4.3,
      aggregation: 'day',
    );

/// Распределение оценок с кадра 09.
const _ratingsFrame09 = <RatingDistributionItem>[
  RatingDistributionItem(rating: 1, count: 58, percentage: 4.7),
  RatingDistributionItem(rating: 2, count: 79, percentage: 6.4),
  RatingDistributionItem(rating: 3, count: 168, percentage: 13.5),
  RatingDistributionItem(rating: 4, count: 331, percentage: 26.7),
  RatingDistributionItem(rating: 5, count: 604, percentage: 48.7),
];

OverviewData _overview() => const OverviewData(
      users: OverviewUsers(total: 3480, newInPeriod: 186),
      establishments: OverviewEstablishments(
        total: 412,
        active: 365,
        pending: 7,
        suspended: 11,
        newInPeriod: 37,
      ),
      reviews: OverviewReviews(total: 1240, newInPeriod: 214, averageRating: 4.3),
      moderation: OverviewModeration(pendingCount: 7, actionsInPeriod: 23),
    );

void main() {
  late _FakeAnalyticsService service;

  // Сервис создаётся здесь, а не в `setUp`: его `Completer`-ы родились бы в
  // чужой зоне, и завершение из тела теста до `pumpAndSettle` не доезжало бы —
  // загрузка висела бы вечно, а экран остался бы на скелетоне.
  Future<void> pump(WidgetTester tester, {double width = 1180}) async {
    service = _FakeAnalyticsService();
    tester.view.physicalSize = Size(width, 820);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<EstablishmentsAnalyticsProvider>(
            create: (_) => EstablishmentsAnalyticsProvider(service: service),
          ),
          ChangeNotifierProvider<UsersAnalyticsProvider>(
            create: (_) => UsersAnalyticsProvider(service: service),
          ),
          ChangeNotifierProvider<ReviewsAnalyticsProvider>(
            create: (_) => ReviewsAnalyticsProvider(service: service),
          ),
          ChangeNotifierProvider<AnalyticsTotalsProvider>(
            create: (_) => AnalyticsTotalsProvider(service: service),
          ),
        ],
        child: MaterialApp(
          theme: AppTheme.lightTheme,
          home: const Scaffold(body: AnalyticsContainerScreen()),
        ),
      ),
    );
    await tester.pump();
  }

  /// Довести раздел до показанной вкладки «Заведения».
  Future<void> pumpEstablishments(
    WidgetTester tester, {
    EstablishmentsAnalyticsData? data,
    double width = 1180,
  }) async {
    await pump(tester, width: width);
    service.answerOverview(_overview());
    service.answerEstablishments(data ?? _establishments());
    await tester.pumpAndSettle();
  }

  // ==========================================================================
  // Кадр 08 — Заведения
  // ==========================================================================

  group('Кадр 08 · Заведения', () {
    testWidgets('первый ряд — четыре метрики кадра', (tester) async {
      await pumpEstablishments(tester);
      expect(find.byType(MetricCard), findsNWidgets(4));
      expect(find.text('ВСЕГО ЗАВЕДЕНИЙ'), findsOneWidget);
      expect(find.text('АКТИВНЫХ'), findsOneWidget);
      expect(find.text('НОВЫХ ЗА ПЕРИОД'), findsOneWidget);
      expect(find.text('НА МОДЕРАЦИИ'), findsOneWidget);
    });

    testWidgets('«На модерации» показывает очередь без дельты', (tester) async {
      await pumpEstablishments(tester);

      // Очередь — остаток работы, а не рост; процент к прошлому периоду для
      // неё бессмыслен, и вместо него стоит нейтральная приписка.
      expect(find.text('очередь на просмотр'), findsOneWidget);
      final card = tester.widget<MetricCard>(
        find.ancestor(
          of: find.text('НА МОДЕРАЦИИ'),
          matching: find.byType(MetricCard),
        ),
      );
      expect(card.changePercent, isNull);
      expect(card.value, '7');
    });

    testWidgets('доля активных считается от каталога', (tester) async {
      await pumpEstablishments(tester);

      // 365 из 412.
      expect(find.text('88,6% каталога'), findsOneWidget);
    });

    testWidgets('легенда статусов идёт каноническим порядком, не по убыванию',
        (tester) async {
      await pumpEstablishments(tester);

      final labels = tester
          .widgetList<ShareLegendRow>(find.byType(ShareLegendRow))
          .map((row) => row.label)
          .toList();

      expect(labels, <String>[
        'Активные',
        'На модерации',
        'Отклонённые',
        'Приостановленные',
        'Черновики',
        'Архив',
      ]);
    });

    testWidgets('приостановленные красятся как отказанные — обе убраны',
        (tester) async {
      await pumpEstablishments(tester);

      final rows = tester
          .widgetList<ShareLegendRow>(find.byType(ShareLegendRow))
          .toList();
      final rejected = rows.firstWhere((r) => r.label == 'Отклонённые');
      final suspended = rows.firstWhere((r) => r.label == 'Приостановленные');

      expect(suspended.color, AppTheme.errorRed);
      expect(rejected.color, suspended.color);
    });

    testWidgets('вывод по городам считается от каталога, не от суммы городов',
        (tester) async {
      await pumpEstablishments(tester);

      // 214 из 412 = 51,9%. От суммы по городам (214+47) вышло бы 82%,
      // и подпись «доля каталога» стала бы неправдой.
      expect(find.text('Минск — 51,9% каталога'), findsOneWidget);
    });

    testWidgets('поместившиеся категории сноской не сопровождаются',
        (tester) async {
      await pumpEstablishments(tester);

      expect(find.textContaining('и ещё'), findsNothing);
    });

    testWidgets('скрытые категории названы числом, а не отброшены молча',
        (tester) async {
      await pumpEstablishments(
        tester,
        data: _establishments(
          categories: <DistributionItem>[
            for (var i = 0; i < 12; i++)
              DistributionItem(label: 'Категория $i', count: 20 - i),
          ],
        ),
      );

      // Двенадцать при девяти показанных: молчаливое усечение читалось бы как
      // «в каталоге девять категорий».
      expect(find.text('и ещё 3 категории'), findsOneWidget);
    });

    testWidgets('пустой каталог объясняется словами, а не пустой карточкой',
        (tester) async {
      await pumpEstablishments(
        tester,
        data: _establishments(
          statuses: const <DistributionItem>[],
          cities: const <DistributionItem>[],
          categories: const <DistributionItem>[],
          total: 0,
        ),
      );

      expect(find.text('В каталоге пока нет заведений'), findsOneWidget);
      expect(find.text('Ни у одного заведения не указан город'), findsOneWidget);
      expect(
        find.text('Ни у одного заведения не указана категория'),
        findsOneWidget,
      );
    });

    testWidgets('до ответа показывается скелетон, а не крутилка',
        (tester) async {
      await pump(tester);

      expect(find.byType(SkeletonBlock), findsWidgets);
      expect(find.byType(CircularProgressIndicator), findsNothing);
    });
  });

  // ==========================================================================
  // Кадр 10 — Пользователи
  // ==========================================================================

  group('Кадр 10 · Пользователи', () {
    Future<void> openUsers(WidgetTester tester) async {
      await pumpEstablishments(tester);
      await tester.tap(find.text('Пользователи'));
      await tester.pump();
      service.answerUsers(_users());
      await tester.pumpAndSettle();
    }

    testWidgets('партнёры и администраторы берутся из ролей', (tester) async {
      await openUsers(tester);

      expect(find.text('ПАРТНЁРОВ'), findsOneWidget);
      expect(find.text('АДМИНИСТРАТОРОВ'), findsOneWidget);
      // 174 из 3 480.
      expect(find.text('5,0% базы'), findsOneWidget);
    });

    testWidgets('роли переведены и стоят каноническим порядком',
        (tester) async {
      await openUsers(tester);

      final labels = tester
          .widgetList<ShareLegendChip>(find.byType(ShareLegendChip))
          .map((chip) => chip.label)
          .toList();

      expect(labels, <String>['Пользователи', 'Партнёры', 'Администраторы']);
    });

    testWidgets('незнакомая роль не теряется — иначе сумма долей не целое',
        (tester) async {
      await pumpEstablishments(tester);
      await tester.tap(find.text('Пользователи'));
      await tester.pump();
      service.answerUsers(
        _users(
          roles: const <DistributionItem>[
            DistributionItem(label: 'user', count: 3291),
            DistributionItem(label: 'moderator', count: 9),
          ],
        ),
      );
      await tester.pumpAndSettle();

      final labels = tester
          .widgetList<ShareLegendChip>(find.byType(ShareLegendChip))
          .map((chip) => chip.label)
          .toList();

      expect(labels, contains('moderator'));
    });

    testWidgets('наблюдатели появляются в доле, только когда они есть',
        (tester) async {
      // Роль панели «только просмотр» (миграция 034). При нуле кадр не
      // меняется — проверено соседним тестом канонического порядка; при
      // первом таком аккаунте роль встаёт после администраторов и с
      // русской подписью, а не ключом базы.
      await pumpEstablishments(tester);
      await tester.tap(find.text('Пользователи'));
      await tester.pump();
      service.answerUsers(
        _users(
          roles: const <DistributionItem>[
            DistributionItem(label: 'user', count: 3291),
            DistributionItem(label: 'partner', count: 174),
            DistributionItem(label: 'admin', count: 15),
            DistributionItem(label: 'viewer', count: 2),
          ],
        ),
      );
      await tester.pumpAndSettle();

      final labels = tester
          .widgetList<ShareLegendChip>(find.byType(ShareLegendChip))
          .map((chip) => chip.label)
          .toList();

      expect(
        labels,
        <String>['Пользователи', 'Партнёры', 'Администраторы', 'Наблюдатели'],
      );
    });

    testWidgets('повторы незнакомой роли складываются, а не отбрасываются',
        (tester) async {
      await pumpEstablishments(tester);
      await tester.tap(find.text('Пользователи'));
      await tester.pump();
      service.answerUsers(
        _users(
          roles: const <DistributionItem>[
            DistributionItem(label: 'user', count: 10),
            DistributionItem(label: 'moderator', count: 6),
            DistributionItem(label: 'moderator', count: 4),
          ],
        ),
      );
      await tester.pumpAndSettle();

      final chips = tester
          .widgetList<ShareLegendChip>(find.byType(ShareLegendChip))
          .toList();
      final unknown = chips.firstWhere((c) => c.label == 'moderator');

      // Отбрасывать вторую строку молча значит обещать целую сумму и не
      // давать её — у статусов аккумулятор складывает, здесь тоже.
      expect(unknown.value, 10);
    });
  });

  // ==========================================================================
  // Кадр 09 — Отзывы и оценки
  // ==========================================================================

  group('Кадр 09 · Отзывы', () {
    Future<void> openReviews(
      WidgetTester tester, {
      ReviewsAnalyticsData? data,
      double width = 1180,
    }) async {
      await pumpEstablishments(tester, width: width);
      await tester.tap(find.text('Отзывы и оценки'));
      await tester.pump();
      service.answerReviews(data ?? _reviews());
      await tester.pumpAndSettle();
    }

    testWidgets('средняя оценка названа величиной за всё время',
        (tester) async {
      await openReviews(tester);

      // Под шапкой с периодом «4,3» читалось бы как «средняя за этот месяц»,
      // тогда как это среднее по всем отзывам за всю историю. Динамику за
      // период показывает зелёная линия на графике выше.
      expect(find.text('СРЕДНЯЯ ОЦЕНКА'), findsOneWidget);
      expect(find.text('за всё время'), findsOneWidget);
    });

    testWidgets('доля ответов считается из своей же выборки', (tester) async {
      await openReviews(tester);

      // 287 из 1240 = 23,1%. Знаменатель едет вместе с числителем — оба из
      // `response_stats`, а не из соседнего `total` или `new_in_period`.
      //
      // Спрашиваем саму карточку, а не текст «23,1%» где-нибудь на экране:
      // такое же число стоит строкой ниже, в «Доле отзывов с ответом», и
      // поиск по тексту проходил бы даже при неверном знаменателе в метрике.
      final card = tester.widget<MetricCard>(
        find.ancestor(
          of: find.text('ПАРТНЁР ОТВЕТИЛ'),
          matching: find.byType(MetricCard),
        ),
      );
      expect(card.value, '23,1%');
      expect(card.valueNote, '287 отзывов');
    });

    testWidgets('оценки идут сверху вниз от пяти звёзд к одной',
        (tester) async {
      await openReviews(tester);

      final counts = <String>['604', '331', '168', '79', '58'];
      final positions = <double>[
        for (final c in counts) tester.getTopLeft(find.text(c)).dy,
      ];

      for (var i = 1; i < positions.length; i++) {
        expect(positions[i], greaterThan(positions[i - 1]),
            reason: 'строка $i должна стоять ниже предыдущей');
      }
    });

    testWidgets('низкие оценки посчитаны и названы', (tester) async {
      await openReviews(tester);

      // 58 + 79 = 137 — единицы и двойки вместе.
      expect(
        find.textContaining('137 отзывов с оценкой 1–2'),
        findsOneWidget,
      );
    });

    testWidgets('без низких оценок сноска не выдумывает ноль', (tester) async {
      await openReviews(
        tester,
        data: _reviews(
          ratings: const <RatingDistributionItem>[
            RatingDistributionItem(rating: 1, count: 0, percentage: 0),
            RatingDistributionItem(rating: 2, count: 0, percentage: 0),
            RatingDistributionItem(rating: 5, count: 10, percentage: 100),
          ],
        ),
      );

      expect(find.text('Отзывов с оценкой 1–2 нет'), findsOneWidget);
    });

    testWidgets('«Отзывов без ответа» — разность из одной выборки',
        (tester) async {
      await openReviews(tester);

      // 1240 − 287 = 953.
      expect(find.text(formatCount(953)), findsOneWidget);
    });

    testWidgets('среднее время ответа с русской запятой', (tester) async {
      await openReviews(tester);

      expect(find.text('18,4 ч'), findsOneWidget);
      expect(find.text('18.4 ч'), findsNothing);
    });

    testWidgets('пустая база не рисует пустые карточки', (tester) async {
      await openReviews(
        tester,
        data: _reviews(
          ratings: const <RatingDistributionItem>[],
          response: const ResponseStats(
            totalReviews: 0,
            totalWithResponse: 0,
            responseRate: 0,
            avgResponseTimeHours: 0,
          ),
        ),
      );

      expect(find.text('Отзывов пока нет'), findsOneWidget);
      expect(find.text('Отвечать пока не на что'), findsOneWidget);
    });

    testWidgets('вывод о темпе ответов считается, а не написан руками',
        (tester) async {
      await openReviews(tester);

      // 287 из 1240 — это каждый четвёртый; 18,4 ч округляются до 18.
      expect(
        find.text('Партнёры отвечают в среднем за 18 часов, '
            'но только на каждый четвёртый отзыв'),
        findsOneWidget,
      );
    });

    testWidgets('вывод следует за данными, а не повторяет кадр',
        (tester) async {
      await openReviews(
        tester,
        data: _reviews(
          response: const ResponseStats(
            totalReviews: 100,
            totalWithResponse: 50,
            responseRate: 0.5,
            avgResponseTimeHours: 2,
          ),
        ),
      );

      // Половина — это «каждый второй», а не «каждый четвёртый».
      expect(
        find.text('Партнёры отвечают в среднем за 2 часа, '
            'но только на каждый второй отзыв'),
        findsOneWidget,
      );
    });

    testWidgets('единственный низкий отзыв согласован по числу',
        (tester) async {
      await openReviews(
        tester,
        data: _reviews(
          ratings: const <RatingDistributionItem>[
            RatingDistributionItem(rating: 1, count: 1, percentage: 10),
            RatingDistributionItem(rating: 5, count: 9, percentage: 90),
          ],
        ),
      );

      // «1 отзыв … их разбирают» читалось бы как ошибка, а не как число.
      expect(
        find.textContaining('1 отзыв с оценкой 1–2 — его разбирают'),
        findsOneWidget,
      );
    });

    testWidgets('пятизначные счётчики не рвут карточку', (tester) async {
      await openReviews(
        tester,
        width: 764,
        data: _reviews(
          ratings: const <RatingDistributionItem>[
            RatingDistributionItem(rating: 1, count: 58000, percentage: 4.7),
            RatingDistributionItem(rating: 2, count: 79000, percentage: 6.4),
            RatingDistributionItem(rating: 3, count: 168000, percentage: 13.5),
            RatingDistributionItem(rating: 4, count: 331000, percentage: 26.7),
            RatingDistributionItem(rating: 5, count: 604000, percentage: 48.7),
          ],
        ),
      );

      // Число без `maxLines` переносилось на вторую строку, строка росла,
      // и карточка фиксированной высоты рвалась.
      expect(tester.takeException(), isNull);
    });

    testWidgets('узкое тело не рвёт вкладку', (tester) async {
      await pumpEstablishments(tester, width: 764);
      await tester.tap(find.text('Отзывы и оценки'));
      await tester.pump();
      service.answerReviews(_reviews());
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
    });
  });

  // ==========================================================================
  // Каркас раздела
  // ==========================================================================

  group('Каркас раздела', () {
    testWidgets('период один на раздел, а не свой у каждой вкладки',
        (tester) async {
      await pumpEstablishments(tester);

      expect(find.byType(PeriodSelector), findsOneWidget);
    });

    testWidgets('подпись шапки называет окно и базу сравнения', (tester) async {
      await pumpEstablishments(tester);

      expect(
        find.text('12 июля — 10 августа 2026 · сравнение с предыдущими 30 днями'),
        findsOneWidget,
      );
    });

    testWidgets('до ответа подпись не исчезает целиком', (tester) async {
      await pump(tester);

      // Заголовок без подписи центрируется по вертикали и прыгает при
      // каждой загрузке — на кадре 06 это уже находили.
      expect(find.text('сравнение с предыдущими 30 днями'), findsOneWidget);
    });

    testWidgets('итог вкладки берётся из её данных, а не из сводки',
        (tester) async {
      await pump(tester);
      service.answerOverview(_overview());
      service.answerEstablishments(_establishments(total: 999));
      await tester.pumpAndSettle();

      // Сводка и вкладка — разные запросы; показывать в подписи одно число,
      // а в карточке под ней другое нельзя.
      expect(find.text('999'), findsWidgets);
      expect(find.text('412'), findsNothing);
    });

    testWidgets('невидимые вкладки за данными не ходят', (tester) async {
      await pumpEstablishments(tester);

      expect(service.establishmentPeriods, hasLength(1));
      expect(service.userPeriods, isEmpty);
      expect(service.reviewPeriods, isEmpty);
    });

    testWidgets('смена периода перечитывает только открытую вкладку',
        (tester) async {
      await pumpEstablishments(tester);

      await tester.tap(find.text('7 дней'));
      await tester.pump();

      expect(service.establishmentPeriods, <String>['30d', '7d']);
      expect(service.userPeriods, isEmpty);
    });

    testWidgets('ещё не открытая вкладка приходит с окном раздела',
        (tester) async {
      await pumpEstablishments(tester);

      await tester.tap(find.text('7 дней'));
      await tester.pump();
      await tester.tap(find.text('Пользователи'));
      await tester.pump();

      // Не «30d»: вкладка обязана прийти уже с выбранным окном, иначе
      // сегмент-контрол показывает одно, а числа под ним — другое.
      expect(service.userPeriods, <String>['7d']);
    });

    testWidgets('уже загруженная вкладка перечитывается после смены периода',
        (tester) async {
      await pumpEstablishments(tester);

      // Вкладка «Пользователи» загружена за 30 дней.
      await tester.tap(find.text('Пользователи'));
      await tester.pump();
      service.answerUsers(_users());
      await tester.pumpAndSettle();
      expect(service.userPeriods, <String>['30d']);

      // Период меняется, пока открыта другая вкладка.
      await tester.tap(find.text('Заведения'));
      await tester.pump();
      await tester.tap(find.text('7 дней'));
      await tester.pump();
      service.answerEstablishments(_establishments());
      await tester.pumpAndSettle();

      // Возврат: данные лежат, но посчитаны за прошлое окно. Без проверки
      // устаревания вкладка показала бы тридцатидневные числа под подписью
      // «7 дней» — ровно то враньё, ради которого период сведён к одному.
      await tester.tap(find.text('Пользователи'));
      await tester.pump();

      expect(service.userPeriods, <String>['30d', '7d']);
    });

    testWidgets('третья вкладка тоже приходит с окном раздела', (tester) async {
      await pumpEstablishments(tester);

      await tester.tap(find.text('7 дней'));
      await tester.pump();
      await tester.tap(find.text('Отзывы и оценки'));
      await tester.pump();
      service.answerReviews(_reviews());
      await tester.pumpAndSettle();

      expect(service.reviewPeriods, <String>['7d']);
    });

    testWidgets('возврат на вкладку во время загрузки не шлёт второй запрос',
        (tester) async {
      await pumpEstablishments(tester);

      // Период сменился — «Заведения» ушли за новыми данными и ещё летят.
      await tester.tap(find.text('7 дней'));
      await tester.pump();
      expect(service.establishmentPeriods, <String>['30d', '7d']);

      // Уход и возврат, пока ответа нет. Данные на вкладке ещё старые, то есть
      // формально она отстала — и без отметки о летящем запросе пошла бы за
      // теми же данными второй раз.
      await tester.tap(find.text('Пользователи'));
      await tester.pump();
      await tester.tap(find.text('Заведения'));
      await tester.pump();

      expect(service.establishmentPeriods, <String>['30d', '7d']);
    });

    testWidgets('неудачное обновление не выдаётся за новые числа',
        (tester) async {
      await pumpEstablishments(tester);

      await tester.tap(find.text('7 дней'));
      await tester.pump();
      service.failEstablishments(Exception('No internet'));
      await tester.pumpAndSettle();

      // Полоса загрузки погасла, приглушение снялось — без сообщения
      // тридцатидневные числа выглядели бы ответом на вопрос о семи днях.
      expect(find.text('Статистика не обновилась'), findsOneWidget);
      expect(find.textContaining('Нет подключения'), findsOneWidget);

      // Подпись описывает то, что на экране, и признаётся, что не обновилась.
      expect(
        find.text('12 июля — 10 августа 2026 · не удалось обновить'),
        findsOneWidget,
      );
      // Прежние числа целы — подменять их нечем.
      expect(find.text('412'), findsWidgets);
    });

    testWidgets('подпись не склеивает окно из данных с базой из выбора',
        (tester) async {
      await pumpEstablishments(tester);

      await tester.tap(find.text('7 дней'));
      await tester.pump();
      service.failEstablishments(Exception('No internet'));
      await tester.pumpAndSettle();

      // Именно эта строка утверждала невозможное: тридцатидневное окно,
      // посчитанное к предыдущим семи дням.
      expect(
        find.text('12 июля — 10 августа 2026 · сравнение с предыдущими 7 днями'),
        findsNothing,
      );
    });

    testWidgets('повтор из тоста уходит с выбранным периодом', (tester) async {
      await pumpEstablishments(tester);

      await tester.tap(find.text('7 дней'));
      await tester.pump();
      service.failEstablishments(Exception('No internet'));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Ещё раз'));
      await tester.pump();

      expect(service.establishmentPeriods, <String>['30d', '7d', '7d']);
    });

    testWidgets('клик по уже выбранному периоду ничего не запрашивает',
        (tester) async {
      await pumpEstablishments(tester);

      await tester.tap(find.text('30 дней'));
      await tester.pump();
      await tester.tap(find.text('30 дней'));
      await tester.pump();

      expect(service.establishmentPeriods, <String>['30d']);
    });

    testWidgets('до загрузки вкладки итог берётся из сводки', (tester) async {
      await pumpEstablishments(tester);

      // «Пользователи» ещё не открывались — число в полосе есть, и оно
      // из overview. Ради этого запаса сводка и запрашивается.
      //
      // Через formatCount, а не строкой: разряды разделены НЕРАЗРЫВНЫМ
      // пробелом, и литерал с обычным не совпал бы ни с чем.
      expect(find.text(formatCount(3480)), findsOneWidget);
    });
  });

  // ==========================================================================
  // Раскладка на реальных данных и в реальных окнах
  // ==========================================================================

  group('Раскладка', () {
    testWidgets('городов больше, чем помещается — обрезка названа числом',
        (tester) async {
      await pumpEstablishments(
        tester,
        data: _establishments(
          cities: <DistributionItem>[
            for (var i = 0; i < 14; i++)
              DistributionItem(label: 'Город $i', count: 200 - i * 10),
          ],
        ),
      );

      // Город приходит свободным текстом из кабинета: на каталоге по Беларуси
      // их заведомо больше шести, и без обрезки карточка рвалась лентой.
      expect(tester.takeException(), isNull);
      expect(find.textContaining('и ещё 8 городов'), findsOneWidget);
    });

    testWidgets('каталог одного города и одного статуса читается', (tester) async {
      // Форма прода на 26.08.2026: около двадцати карточек, все Минск, все
      // активные. Раньше это состояние ничем не проверялось — самый
      // реалистичный случай оказался самым непокрытым.
      await pumpEstablishments(
        tester,
        data: _establishments(
          total: 20,
          statuses: const <DistributionItem>[
            DistributionItem(label: 'active', count: 20),
          ],
          cities: const <DistributionItem>[
            DistributionItem(label: 'Минск', count: 20),
          ],
          categories: const <DistributionItem>[
            DistributionItem(label: 'Ресторан', count: 9),
            DistributionItem(label: 'Кофейня', count: 7),
            DistributionItem(label: 'Бар', count: 4),
          ],
        ),
      );

      expect(tester.takeException(), isNull);

      // Единственный город — это весь каталог, и сноска не должна обещать хвост.
      expect(find.text('Минск — 100,0% каталога'), findsOneWidget);
      expect(find.textContaining('и ещё'), findsNothing);

      // Пустые статусы остаются в легенде нулями: «на модерации ноль» — это
      // ответ, а пропуск строки читался бы как «мы не знаем».
      final rows = tester
          .widgetList<ShareLegendRow>(find.byType(ShareLegendRow))
          .toList();
      expect(rows, hasLength(6));
      expect(rows.firstWhere((r) => r.label == 'Активные').value, 20);
      expect(rows.firstWhere((r) => r.label == 'На модерации').value, 0);
    });

    testWidgets('двадцать городов не ломают карточку', (tester) async {
      await pumpEstablishments(
        tester,
        data: _establishments(
          cities: <DistributionItem>[
            for (var i = 0; i < 20; i++)
              DistributionItem(label: 'Город $i', count: 300 - i * 5),
          ],
        ),
      );

      expect(tester.takeException(), isNull);
    });

    testWidgets('узкое тело не рвёт ряд метрик', (tester) async {
      // 764 — это ширина ТЕЛА при окне 1024: рейл админки забирает 260.
      // Экран здесь пампится без рейла, поэтому ширину тела задаём напрямую,
      // иначе тест мерил бы окно, а верстается по телу.
      //
      // На такой ширине под карточку остаётся около 180 пикселей, и приписка
      // «очередь на просмотр» выпирала за её край лентой переполнения.
      await pumpEstablishments(tester, width: 764);

      expect(tester.takeException(), isNull);
      expect(find.byType(MetricCard), findsNWidgets(4));
    });

    testWidgets('узкое тело не рвёт вкладку пользователей', (tester) async {
      await pumpEstablishments(tester, width: 764);
      await tester.tap(find.text('Пользователи'));
      await tester.pump();
      service.answerUsers(_users());
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
    });
  });

  group('Каркас раздела · продолжение', () {
    testWidgets('сводка запрашивается один раз и не следует за периодом',
        (tester) async {
      await pumpEstablishments(tester);

      await tester.tap(find.text('7 дней'));
      await tester.pump();

      expect(service.overviewCalls, 1);
    });
  });
}
