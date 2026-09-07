import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/models/notification_model.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/providers/notification_provider.dart';
import 'package:restaurant_guide_mobile/screens/establishment/detail_screen.dart';
import 'package:restaurant_guide_mobile/screens/main_navigation.dart';
import 'package:restaurant_guide_mobile/screens/partner/partner_menu_screen.dart';
import 'package:restaurant_guide_mobile/screens/partner/partner_reviews_screen.dart';

/// Screen displaying a grouped list of notifications
/// Supports filtering by category, pull-to-refresh, and pagination
class NotificationListScreen extends StatefulWidget {
  const NotificationListScreen({super.key});

  @override
  State<NotificationListScreen> createState() => _NotificationListScreenState();
}

class _NotificationListScreenState extends State<NotificationListScreen> {
  final ScrollController _scrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
    // Load notifications on screen open
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<NotificationProvider>().fetchNotifications(refresh: true);
    });
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (_scrollController.position.pixels >=
        _scrollController.position.maxScrollExtent - 200) {
      context.read<NotificationProvider>().loadMore();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.backgroundWarm,
      body: SafeArea(
        child: Column(
        children: [
          // Header matching profile screen style
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
            child: Row(
              children: [
                GestureDetector(
                  onTap: () => Navigator.of(context).pop(),
                  child: const Icon(
                    Icons.chevron_left,
                    size: 28,
                    color: AppTheme.textPrimary,
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  'Уведомления',
                  style: TextStyle(
                    fontFamily: AppTheme.fontDisplayFamily,
                    fontSize: 25,
                    fontWeight: FontWeight.w400,
                    color: AppTheme.primaryOrangeDark,
                  ),
                ),
              ],
            ),
          ),
          // Filter chips
          _buildFilterChips(),
          // Notification list
          Expanded(
            child: Consumer<NotificationProvider>(
              builder: (context, provider, _) {
                if (provider.isLoading && provider.notifications.isEmpty) {
                  return const Center(child: CircularProgressIndicator());
                }

                if (provider.notifications.isEmpty) {
                  return _buildEmptyState();
                }

                final groups = _groupNotifications(provider.notifications);

                return RefreshIndicator(
                  onRefresh: () =>
                      provider.fetchNotifications(refresh: true),
                  child: ListView.builder(
                    controller: _scrollController,
                    itemCount: _countGroupedItems(groups) +
                        (provider.hasMore ? 1 : 0),
                    itemBuilder: (context, index) {
                      return _buildGroupedItem(
                          context, groups, index, provider);
                    },
                  ),
                );
              },
            ),
          ),
        ],
      ),
      ),
    );
  }

  // ============================================================================
  // Filter Chips
  // ============================================================================

  Widget _buildFilterChips() {
    final authProvider = context.watch<AuthProvider>();
    final notificationProvider = context.watch<NotificationProvider>();
    final isPartner = authProvider.currentUser?.role == 'partner';
    final currentCategory = notificationProvider.currentCategory;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Row(
        children: [
          _buildChip(
            label: 'Все',
            selected: currentCategory == null,
            onSelected: () => notificationProvider.setCategory(null),
          ),
          if (isPartner) ...[
            const SizedBox(width: 8),
            _buildChip(
              label: 'Мои заведения',
              selected: currentCategory == 'establishments',
              onSelected: () =>
                  notificationProvider.setCategory('establishments'),
            ),
          ],
          const SizedBox(width: 8),
          _buildChip(
            label: 'Мои отзывы',
            selected: currentCategory == 'reviews',
            onSelected: () => notificationProvider.setCategory('reviews'),
          ),
        ],
      ),
    );
  }

  Widget _buildChip({
    required String label,
    required bool selected,
    required VoidCallback onSelected,
  }) {
    return ChoiceChip(
      label: Text(label),
      selected: selected,
      onSelected: (_) => onSelected(),
      selectedColor: AppTheme.primaryOrange.withValues(alpha: 0.15),
      labelStyle: TextStyle(
        color: selected ? AppTheme.primaryOrange : AppTheme.gray700,
        fontSize: 13,
        fontWeight: selected ? FontWeight.w600 : FontWeight.normal,
      ),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
        side: BorderSide(
          color: selected ? AppTheme.primaryOrange : AppTheme.gray300,
        ),
      ),
      showCheckmark: false,
      backgroundColor: Colors.white,
    );
  }

  // ============================================================================
  // Empty State
  // ============================================================================

  Widget _buildEmptyState() {
    return const Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.notifications_none,
            size: 64,
            color: AppTheme.gray300,
          ),
          SizedBox(height: 16),
          Text(
            'Нет уведомлений',
            style: TextStyle(
              fontSize: 16,
              color: AppTheme.gray500,
            ),
          ),
        ],
      ),
    );
  }

  // ============================================================================
  // Grouping Logic
  // ============================================================================

  /// Group notifications: unread → "Новые", then read by time period
  List<_NotificationGroup> _groupNotifications(
      List<NotificationModel> notifications) {
    final unread = <NotificationModel>[];
    final todayRead = <NotificationModel>[];
    final weekRead = <NotificationModel>[];
    final olderRead = <NotificationModel>[];

    final now = DateTime.now();
    final todayStart = DateTime(now.year, now.month, now.day);
    final weekStart = todayStart.subtract(const Duration(days: 7));

    for (final n in notifications) {
      if (!n.isRead) {
        unread.add(n);
      } else if (n.createdAt.isAfter(todayStart)) {
        todayRead.add(n);
      } else if (n.createdAt.isAfter(weekStart)) {
        weekRead.add(n);
      } else {
        olderRead.add(n);
      }
    }

    final groups = <_NotificationGroup>[];
    if (unread.isNotEmpty) {
      groups.add(_NotificationGroup('Новые', unread));
    }
    if (todayRead.isNotEmpty) {
      groups.add(_NotificationGroup('Сегодня', todayRead));
    }
    if (weekRead.isNotEmpty) {
      groups.add(_NotificationGroup('На этой неделе', weekRead));
    }
    if (olderRead.isNotEmpty) {
      groups.add(_NotificationGroup('Ранее', olderRead));
    }

    return groups;
  }

  int _countGroupedItems(List<_NotificationGroup> groups) {
    int count = 0;
    for (final group in groups) {
      count += 1 + group.notifications.length; // header + items
    }
    return count;
  }

  Widget _buildGroupedItem(
    BuildContext context,
    List<_NotificationGroup> groups,
    int index,
    NotificationProvider provider,
  ) {
    // Loading indicator at the bottom
    final totalGroupedItems = _countGroupedItems(groups);
    if (index >= totalGroupedItems) {
      return const Padding(
        padding: EdgeInsets.all(16),
        child: Center(child: CircularProgressIndicator()),
      );
    }

    // Find which group and position within group
    int remaining = index;
    for (final group in groups) {
      if (remaining == 0) {
        // Section header
        return _buildSectionHeader(group.title);
      }
      remaining--;

      if (remaining < group.notifications.length) {
        return _NotificationCard(
          notification: group.notifications[remaining],
          onTap: () => _onNotificationTap(group.notifications[remaining]),
        );
      }
      remaining -= group.notifications.length;
    }

    return const SizedBox.shrink();
  }

  Widget _buildSectionHeader(String title) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      child: Text(
        title,
        style: const TextStyle(
          fontSize: 14,
          fontWeight: FontWeight.w600,
          color: AppTheme.gray500,
        ),
      ),
    );
  }

  // ============================================================================
  // Navigation on Tap
  // ============================================================================

  void _onNotificationTap(NotificationModel notification) {
    // Mark as read
    if (!notification.isRead) {
      context.read<NotificationProvider>().markAsRead(notification.id);
    }

    // Navigate based on type
    switch (notification.type) {
      case NotificationType.newReview:
        // Partner tapped "new review" → open partner reviews screen to respond
        if (notification.establishmentId != null) {
          Navigator.of(context, rootNavigator: true).push(
            MaterialPageRoute(
              builder: (_) => PartnerReviewsScreen(
                establishmentId: notification.establishmentId!,
              ),
            ),
          );
        }
      case NotificationType.establishmentApproved:
      case NotificationType.partnerResponse:
        // Navigate to establishment detail
        if (notification.establishmentId != null) {
          Navigator.of(context, rootNavigator: true).push(
            MaterialPageRoute(
              builder: (_) => EstablishmentDetailScreen(
                establishmentId: notification.establishmentId!,
              ),
            ),
          );
        }
      case NotificationType.establishmentRejected:
      case NotificationType.establishmentSuspended:
        // Navigate to partner edit screen
        if (notification.establishmentId != null) {
          Navigator.of(context, rootNavigator: true).pushNamed(
            '/partner/edit/${notification.establishmentId}',
          );
        }
      case NotificationType.reviewHidden:
      case NotificationType.reviewDeleted:
        // Go to profile tab (my reviews section)
        Navigator.of(context).pop();
        MainNavigationScreenState.instance?.switchToTab(4);
      case NotificationType.establishmentUnsuspended:
      case NotificationType.establishmentClaimed:
        // Navigate to establishment detail
        if (notification.establishmentId != null) {
          Navigator.of(context, rootNavigator: true).push(
            MaterialPageRoute(
              builder: (_) => EstablishmentDetailScreen(
                establishmentId: notification.establishmentId!,
              ),
            ),
          );
        }
      case NotificationType.bookingReceived:
      case NotificationType.bookingConfirmed:
      case NotificationType.bookingDeclined:
      case NotificationType.bookingExpired:
      case NotificationType.bookingCancelled:
        // Go to profile tab (bookings accessible from there)
        Navigator.of(context).pop();
        MainNavigationScreenState.instance?.switchToTab(4);
      case NotificationType.promotionNew:
        // Navigate to establishment detail (promotion visible there)
        if (notification.establishmentId != null) {
          Navigator.of(context, rootNavigator: true).push(
            MaterialPageRoute(
              builder: (_) => EstablishmentDetailScreen(
                establishmentId: notification.establishmentId!,
              ),
            ),
          );
        }
      case NotificationType.menuParsed:
      case NotificationType.menuItemHiddenByAdmin:
        // Component 8, Segment C: open partner menu section.
        // Скрытие позиции модератором ведёт туда же: партнёр видит
        // свой раздел меню, где позиции больше нет.
        if (notification.establishmentId != null) {
          Navigator.of(context, rootNavigator: true).push(
            MaterialPageRoute(
              builder: (_) => PartnerMenuScreen(
                establishmentId: notification.establishmentId!,
              ),
            ),
          );
        }
    }
  }
}

// ============================================================================
// Private Helper Classes
// ============================================================================

class _NotificationGroup {
  final String title;
  final List<NotificationModel> notifications;

  _NotificationGroup(this.title, this.notifications);
}

// ============================================================================
// Notification Card Widget
// ============================================================================

class _NotificationCard extends StatelessWidget {
  final NotificationModel notification;
  final VoidCallback onTap;

  const _NotificationCard({
    required this.notification,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        decoration: BoxDecoration(
          color: notification.isRead
              ? Colors.white
              : AppTheme.primaryOrange.withValues(alpha: 0.05),
          border: const Border(
            bottom: BorderSide(color: AppTheme.gray300, width: 0.5),
          ),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Colored icon circle
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: notification.color.withValues(alpha: 0.15),
                shape: BoxShape.circle,
              ),
              child: Icon(
                notification.icon,
                color: notification.color,
                size: 20,
              ),
            ),
            const SizedBox(width: 12),
            // Content
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    notification.title,
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight:
                          notification.isRead ? FontWeight.normal : FontWeight.w600,
                      color: AppTheme.textPrimary,
                    ),
                  ),
                  if (notification.message != null) ...[
                    const SizedBox(height: 2),
                    Text(
                      notification.message!,
                      style: const TextStyle(
                        fontSize: 13,
                        color: AppTheme.gray700,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                  const SizedBox(height: 4),
                  Text(
                    formatRelativeTime(notification.createdAt),
                    style: const TextStyle(
                      fontSize: 12,
                      color: AppTheme.gray500,
                    ),
                  ),
                ],
              ),
            ),
            // Unread dot indicator
            if (!notification.isRead)
              Padding(
                padding: const EdgeInsets.only(top: 4, left: 8),
                child: Container(
                  width: 8,
                  height: 8,
                  decoration: const BoxDecoration(
                    color: AppTheme.primaryOrange,
                    shape: BoxShape.circle,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
