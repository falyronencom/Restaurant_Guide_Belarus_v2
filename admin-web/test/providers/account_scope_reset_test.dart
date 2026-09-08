import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/models/admin_review_item.dart';
import 'package:restaurant_guide_admin_web/providers/admin_reviews_provider.dart';
import 'package:restaurant_guide_admin_web/providers/audit_log_provider.dart';
import 'package:restaurant_guide_admin_web/providers/menu_items_moderation_provider.dart';
import 'package:restaurant_guide_admin_web/providers/moderation_provider.dart';
import 'package:restaurant_guide_admin_web/services/account_scope.dart';
import 'package:restaurant_guide_admin_web/services/admin_menu_item_service.dart';
import 'package:restaurant_guide_admin_web/services/admin_review_service.dart';
import 'package:restaurant_guide_admin_web/services/audit_log_service.dart';
import 'package:restaurant_guide_admin_web/services/moderation_service.dart';

// Что именно стирает сброс при смене аккаунта.
//
// Сторож реестра (`test/config/account_scope_guard_test.dart`) доказывает, что
// каждый провайдер зарегистрирован. Здесь — что сброс делает то, ради чего
// заведён: вердикты, выбор, фильтры и раскрытая строка исчезают, а ответ,
// летевший для прежнего аккаунта, в состояние нового не ложится.

class _FakeModerationService implements ModerationService {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeReviewService implements AdminReviewService {
  Completer<AdminReviewListResponse> response =
      Completer<AdminReviewListResponse>();

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
  }) =>
      response.future;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeMenuItemService implements AdminMenuItemService {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeAuditLogService implements AuditLogService {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

AdminReviewItem _review(String id) => AdminReviewItem(
      id: id,
      rating: 4,
      content: 'Смачна',
      authorName: 'Марына К.',
      establishmentName: 'Кухмістр',
      isVisible: true,
      isDeleted: false,
      createdAt: DateTime(2026, 8, 12),
    );

void main() {
  setUp(AccountScope.debugReset);
  tearDown(AccountScope.debugReset);

  test('модерация: вердикты по полям и выбор принадлежат вошедшему', () {
    final provider = ModerationProvider(service: _FakeModerationService());
    addTearDown(provider.dispose);

    provider.approveField('unp');
    provider.rejectField('name', comment: 'опечатка');
    expect(provider.checkedFieldCount, 2);
    expect(provider.canApprove, isFalse);

    AccountScope.resetAll();

    expect(provider.checkedFieldCount, 0);
    expect(provider.canApprove, isTrue);
    expect(provider.selectedId, isNull);
    expect(provider.selectedDetail, isNull);
  });

  test('отзывы: фильтры снимаются, а обогнанный ответ выбрасывается',
      () async {
    final service = _FakeReviewService();
    final provider = AdminReviewsProvider(service: service);
    addTearDown(provider.dispose);

    provider.setStatusFilter('hidden');
    expect(provider.hasActiveFilters, isTrue);
    expect(provider.isLoadingList, isTrue);

    AccountScope.resetAll();

    expect(provider.hasActiveFilters, isFalse);
    expect(provider.statusFilter, isNull);
    expect(provider.isLoadingList, isFalse);

    // Ответ на запрос прежнего аккаунта доезжает после сброса — и не
    // должен стать списком нового.
    service.response.complete(AdminReviewListResponse(
      reviews: <AdminReviewItem>[_review('r1')],
      total: 1,
      hidden: 0,
      averageRating: 4,
      page: 1,
      pages: 1,
    ));
    await pumpEventQueue();

    expect(provider.reviews, isEmpty);
    expect(provider.totalCount, 0);
  });

  test('позиции меню: выбор снимается, первая загрузка начинается заново', () {
    final provider = MenuItemsModerationProvider(service: _FakeMenuItemService());
    addTearDown(provider.dispose);

    provider.selectItem('1');
    expect(provider.selectedId, '1');

    AccountScope.resetAll();

    expect(provider.selectedId, isNull);
    expect(provider.isFirstLoad, isTrue);
    expect(provider.hasLoaded, isFalse);
  });

  test('журнал: раскрытая строка закрывается, период возвращается к 30 дням',
      () {
    final provider = AuditLogProvider(service: _FakeAuditLogService());
    addTearDown(provider.dispose);

    provider.toggleExpanded('e1');
    expect(provider.expandedEntryId, 'e1');

    AccountScope.resetAll();

    expect(provider.expandedEntryId, isNull);
    expect(provider.period, AuditLogProvider.defaultPeriod);
    expect(provider.hasActiveFilters, isFalse);
  });
}
