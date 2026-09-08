import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/establishment.dart';
import 'package:restaurant_guide_admin_web/providers/approved_provider.dart';
import 'package:restaurant_guide_admin_web/providers/auth_provider.dart';
import 'package:restaurant_guide_admin_web/providers/badges_provider.dart';
import 'package:restaurant_guide_admin_web/providers/moderation_provider.dart';
import 'package:restaurant_guide_admin_web/providers/suspended_provider.dart';
import 'package:restaurant_guide_admin_web/screens/moderation/approved_screen.dart';
import 'package:restaurant_guide_admin_web/screens/moderation/pending_moderation_screen.dart';
import 'package:restaurant_guide_admin_web/screens/moderation/suspended_screen.dart';

import '../helpers/stub_auth.dart';

// Роль «только просмотр» (SDL CAT-C-2.11) на трёх экранах заведений.
//
// Проверяется обещание, а не оформление: просмотрщик видит те же карточки,
// что администратор, но ни одной кнопки действия. Сервер ответил бы ему 403;
// кнопка, обещающая то, что не выполнится, читается как поломка — поэтому
// её нет вовсе. Каждая пара тестов держит обе стороны: у администратора
// кнопка есть (иначе гейт мог бы прятать её от всех, и тест зеленел бы).

EstablishmentDetail _detail({required String status}) => EstablishmentDetail(
      id: 'a41f9c02-1234-5678-9abc-def012345678',
      partnerId: 'p-1',
      name: 'Кухмістр',
      status: status,
      city: 'Минск',
      categories: const <String>['Ресторан'],
      cuisines: const <String>['Народная'],
      phone: '+375 29 611-24-80',
      unp: '191482073',
      legalName: 'ООО «Кухмістр Плюс»',
      moderationNotes: status == 'suspended'
          ? <String, dynamic>{
              'suspend_reason': 'Жалобы посетителей',
              'suspended_at': '2026-08-07T11:40:00.000Z',
            }
          : null,
    );

class _StubBadges extends BadgesProvider {
  @override
  Future<void> load() async {}
}

/// Очередь с одной уже загруженной карточкой: сеть в стенде не нужна.
class _StubModerationProvider extends ModerationProvider {
  final EstablishmentDetail _detail;

  _StubModerationProvider(this._detail);

  @override
  Future<void> loadPendingEstablishments({int page = 1}) async {}

  @override
  List<EstablishmentListItem> get establishments => const <EstablishmentListItem>[];

  @override
  bool get isLoadingList => false;

  @override
  String? get listError => null;

  @override
  String? get selectedId => _detail.id;

  @override
  EstablishmentDetail? get selectedDetail => _detail;

  @override
  bool get isLoadingDetail => false;

  @override
  String? get detailError => null;
}

class _StubApprovedProvider extends ApprovedProvider {
  final EstablishmentDetail _detail;

  _StubApprovedProvider(this._detail);

  @override
  Future<void> loadActiveEstablishments({int page = 1}) async {}

  @override
  String? get selectedId => _detail.id;

  @override
  EstablishmentDetail? get selectedDetail => _detail;

  @override
  bool get isLoadingDetail => false;

  @override
  String? get detailError => null;
}

class _StubSuspendedProvider extends SuspendedProvider {
  final EstablishmentDetail _detail;

  _StubSuspendedProvider(this._detail);

  @override
  Future<void> loadSuspendedEstablishments({int page = 1}) async {}

  @override
  String? get selectedId => _detail.id;

  @override
  EstablishmentDetail? get selectedDetail => _detail;

  @override
  bool get isLoadingDetail => false;

  @override
  String? get detailError => null;
}

void main() {
  Future<void> pumpScreen<P extends ChangeNotifier>(
    WidgetTester tester, {
    required P provider,
    required Widget screen,
    required bool viewer,
  }) async {
    tester.view.physicalSize = const Size(1440, 820);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    // `.value` не освобождает переданное — это делает создатель.
    addTearDown(provider.dispose);

    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<P>.value(value: provider),
          ChangeNotifierProvider<BadgesProvider>(create: (_) => _StubBadges()),
          ChangeNotifierProvider<AuthProvider>(
            create: (_) =>
                viewer ? StubAuthProvider.viewer() : StubAuthProvider.admin(),
          ),
        ],
        child: MaterialApp(
          theme: AppTheme.lightTheme,
          home: Scaffold(body: screen),
        ),
      ),
    );
    await tester.pump();
  }

  group('Ожидают просмотра', () {
    testWidgets('администратор: панель в режиме модерации с вердиктами',
        (tester) async {
      await pumpScreen<ModerationProvider>(
        tester,
        provider: _StubModerationProvider(_detail(status: 'pending')),
        screen: const PendingModerationScreen(),
        viewer: false,
      );

      expect(find.text('Одобрить заведение'), findsOneWidget);
      expect(find.text('Отклонить заявку'), findsOneWidget);
    });

    testWidgets('просмотрщик: карточка читается, вердиктов нет',
        (tester) async {
      await pumpScreen<ModerationProvider>(
        tester,
        provider: _StubModerationProvider(_detail(status: 'pending')),
        screen: const PendingModerationScreen(),
        viewer: true,
      );

      expect(find.text('Одобрить заведение'), findsNothing);
      expect(find.text('Отклонить заявку'), findsNothing);
      // Режим чтения показывает ту же карточку — с названием в сетке.
      expect(find.text('Кухмістр'), findsWidgets);
    });
  });

  group('Одобренные', () {
    testWidgets('администратор: действия в шапке', (tester) async {
      await pumpScreen<ApprovedProvider>(
        tester,
        provider: _StubApprovedProvider(_detail(status: 'active')),
        screen: const ApprovedScreen(),
        viewer: false,
      );

      expect(find.text('Приостановить'), findsOneWidget);
      expect(find.text('Назначить партнёра'), findsOneWidget);
    });

    testWidgets('просмотрщик: карточка есть, действий в шапке нет',
        (tester) async {
      await pumpScreen<ApprovedProvider>(
        tester,
        provider: _StubApprovedProvider(_detail(status: 'active')),
        screen: const ApprovedScreen(),
        viewer: true,
      );

      expect(find.text('Приостановить'), findsNothing);
      expect(find.text('Назначить партнёра'), findsNothing);
      expect(find.text('Кухмістр'), findsWidgets);
    });
  });

  group('Приостановленные', () {
    testWidgets('администратор: «Возобновить» в шапке', (tester) async {
      await pumpScreen<SuspendedProvider>(
        tester,
        provider: _StubSuspendedProvider(_detail(status: 'suspended')),
        screen: const SuspendedScreen(),
        viewer: false,
      );

      expect(find.text('Возобновить'), findsOneWidget);
    });

    testWidgets('просмотрщик: причина видна, «Возобновить» нет',
        (tester) async {
      await pumpScreen<SuspendedProvider>(
        tester,
        provider: _StubSuspendedProvider(_detail(status: 'suspended')),
        screen: const SuspendedScreen(),
        viewer: true,
      );

      expect(find.text('Возобновить'), findsNothing);
      expect(find.text('Жалобы посетителей'), findsOneWidget);
    });
  });
}
