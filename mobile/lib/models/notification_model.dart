import 'package:flutter/material.dart';

/// Notification type enum matching backend notification types
enum NotificationType {
  establishmentApproved,
  establishmentRejected,
  establishmentSuspended,
  newReview,
  partnerResponse,
  reviewHidden,
  reviewDeleted,
  establishmentUnsuspended,
  establishmentClaimed,
  bookingReceived,
  bookingConfirmed,
  bookingDeclined,
  bookingExpired,
  bookingCancelled,
  promotionNew,
  menuParsed,
  menuItemHiddenByAdmin;

  static NotificationType fromString(String value) {
    switch (value) {
      case 'establishment_approved':
        return NotificationType.establishmentApproved;
      case 'establishment_rejected':
        return NotificationType.establishmentRejected;
      case 'establishment_suspended':
        return NotificationType.establishmentSuspended;
      case 'establishment_unsuspended':
        return NotificationType.establishmentUnsuspended;
      case 'establishment_claimed':
        return NotificationType.establishmentClaimed;
      case 'new_review':
        return NotificationType.newReview;
      case 'partner_response':
        return NotificationType.partnerResponse;
      case 'review_hidden':
        return NotificationType.reviewHidden;
      case 'review_deleted':
        return NotificationType.reviewDeleted;
      case 'booking_received':
        return NotificationType.bookingReceived;
      case 'booking_confirmed':
        return NotificationType.bookingConfirmed;
      case 'booking_declined':
        return NotificationType.bookingDeclined;
      case 'booking_expired':
        return NotificationType.bookingExpired;
      case 'booking_cancelled':
        return NotificationType.bookingCancelled;
      case 'promotion_new':
        return NotificationType.promotionNew;
      case 'menu_parsed':
        return NotificationType.menuParsed;
      case 'menu_item_hidden_by_admin':
        return NotificationType.menuItemHiddenByAdmin;
      default:
        return NotificationType.newReview;
    }
  }
}

/// Category for filtering notifications
enum NotificationCategory {
  establishments,
  reviews;
}

/// Notification model matching backend API response
class NotificationModel {
  final String id;
  final String userId;
  final NotificationType type;
  final String title;
  final String? message;
  final String? establishmentId;
  final String? reviewId;
  final bool isRead;
  final DateTime createdAt;

  const NotificationModel({
    required this.id,
    required this.userId,
    required this.type,
    required this.title,
    this.message,
    this.establishmentId,
    this.reviewId,
    required this.isRead,
    required this.createdAt,
  });

  /// Category based on notification type (for filtering)
  NotificationCategory get category {
    switch (type) {
      case NotificationType.establishmentApproved:
      case NotificationType.establishmentRejected:
      case NotificationType.establishmentSuspended:
      case NotificationType.establishmentUnsuspended:
      case NotificationType.establishmentClaimed:
      case NotificationType.newReview:
        return NotificationCategory.establishments;
      case NotificationType.partnerResponse:
      case NotificationType.reviewHidden:
      case NotificationType.reviewDeleted:
        return NotificationCategory.reviews;
      case NotificationType.bookingReceived:
      case NotificationType.bookingConfirmed:
      case NotificationType.bookingDeclined:
      case NotificationType.bookingExpired:
      case NotificationType.bookingCancelled:
        return NotificationCategory.establishments;
      case NotificationType.promotionNew:
      case NotificationType.menuParsed:
      case NotificationType.menuItemHiddenByAdmin:
        return NotificationCategory.establishments;
    }
  }

  /// Icon for notification type
  IconData get icon {
    switch (type) {
      case NotificationType.establishmentApproved:
        return Icons.check_circle;
      case NotificationType.establishmentRejected:
        return Icons.cancel;
      case NotificationType.establishmentSuspended:
        return Icons.pause_circle;
      case NotificationType.newReview:
        return Icons.star;
      case NotificationType.partnerResponse:
        return Icons.chat_bubble;
      case NotificationType.reviewHidden:
        return Icons.visibility_off;
      case NotificationType.reviewDeleted:
        return Icons.delete_outline;
      case NotificationType.establishmentUnsuspended:
        return Icons.play_circle;
      case NotificationType.establishmentClaimed:
        return Icons.store;
      case NotificationType.bookingReceived:
        return Icons.calendar_today;
      case NotificationType.bookingConfirmed:
        return Icons.event_available;
      case NotificationType.bookingDeclined:
        return Icons.event_busy;
      case NotificationType.bookingExpired:
        return Icons.schedule;
      case NotificationType.bookingCancelled:
        return Icons.cancel_schedule_send;
      case NotificationType.promotionNew:
        return Icons.local_offer;
      case NotificationType.menuParsed:
        return Icons.menu_book;
      case NotificationType.menuItemHiddenByAdmin:
        return Icons.visibility_off;
    }
  }

  /// Color for notification type icon
  Color get color {
    switch (type) {
      case NotificationType.establishmentApproved:
        return const Color(0xFF4CAF50);
      case NotificationType.establishmentRejected:
        return const Color(0xFFF44336);
      case NotificationType.establishmentSuspended:
        return const Color(0xFFF06B32);
      case NotificationType.newReview:
        return const Color(0xFFFFC107);
      case NotificationType.partnerResponse:
        return const Color(0xFF2196F3);
      case NotificationType.reviewHidden:
      case NotificationType.reviewDeleted:
        return const Color(0xFF9E9E9E);
      case NotificationType.establishmentUnsuspended:
        return const Color(0xFF4CAF50);
      case NotificationType.establishmentClaimed:
        return const Color(0xFF2196F3);
      case NotificationType.bookingReceived:
        return const Color(0xFFF06B32);
      case NotificationType.bookingConfirmed:
        return const Color(0xFF4CAF50);
      case NotificationType.bookingDeclined:
      case NotificationType.bookingExpired:
      case NotificationType.bookingCancelled:
        return const Color(0xFF9E9E9E);
      case NotificationType.promotionNew:
        return const Color(0xFFFF9800);
      case NotificationType.menuParsed:
        return const Color(0xFF2196F3);
      case NotificationType.menuItemHiddenByAdmin:
        return const Color(0xFF9E9E9E);
    }
  }

  /// Factory from JSON — handles both snake_case and camelCase keys
  factory NotificationModel.fromJson(Map<String, dynamic> json) {
    return NotificationModel(
      id: (json['id'] ?? json['notificationId'] ?? '').toString(),
      userId: (json['user_id'] ?? json['userId'] ?? '').toString(),
      type: NotificationType.fromString(
        json['type'] as String? ?? 'new_review',
      ),
      title: json['title'] as String? ?? '',
      message: json['message'] as String?,
      establishmentId:
          (json['establishment_id'] ?? json['establishmentId'])?.toString(),
      reviewId: (json['review_id'] ?? json['reviewId'])?.toString(),
      isRead: json['is_read'] as bool? ?? json['isRead'] as bool? ?? false,
      createdAt: DateTime.parse(
        json['created_at'] as String? ??
            json['createdAt'] as String? ??
            DateTime.now().toIso8601String(),
      ),
    );
  }

  /// Create a copy with updated read status
  NotificationModel copyWith({bool? isRead}) {
    return NotificationModel(
      id: id,
      userId: userId,
      type: type,
      title: title,
      message: message,
      establishmentId: establishmentId,
      reviewId: reviewId,
      isRead: isRead ?? this.isRead,
      createdAt: createdAt,
    );
  }
}

/// Russian relative time formatting
String formatRelativeTime(DateTime dateTime) {
  final now = DateTime.now();
  final diff = now.difference(dateTime);

  if (diff.inSeconds < 60) return 'Только что';
  if (diff.inMinutes < 60) return _pluralMinutes(diff.inMinutes);
  if (diff.inHours < 24) return _pluralHours(diff.inHours);

  // Check if yesterday
  final yesterday = DateTime(now.year, now.month, now.day - 1);
  if (dateTime.year == yesterday.year &&
      dateTime.month == yesterday.month &&
      dateTime.day == yesterday.day) {
    return 'Вчера';
  }

  if (diff.inDays < 7) return _pluralDays(diff.inDays);

  // Older: show date
  const months = [
    '', 'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
  ];
  return '${dateTime.day} ${months[dateTime.month]}';
}

String _pluralMinutes(int n) {
  final mod10 = n % 10;
  final mod100 = n % 100;
  if (mod10 == 1 && mod100 != 11) return '$n минуту назад';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
    return '$n минуты назад';
  }
  return '$n минут назад';
}

String _pluralHours(int n) {
  final mod10 = n % 10;
  final mod100 = n % 100;
  if (mod10 == 1 && mod100 != 11) return '$n час назад';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
    return '$n часа назад';
  }
  return '$n часов назад';
}

String _pluralDays(int n) {
  final mod10 = n % 10;
  final mod100 = n % 100;
  if (mod10 == 1 && mod100 != 11) return '$n день назад';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
    return '$n дня назад';
  }
  return '$n дней назад';
}
