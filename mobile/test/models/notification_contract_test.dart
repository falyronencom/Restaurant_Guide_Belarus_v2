import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/models/notification_model.dart';

/// Контракт провода для уведомлений и русских относительных дат.
///
/// Два молчаливых отказа живут здесь рядом. Первый: неизвестный тип
/// уведомления не отбрасывается и не помечается, а превращается в «новый
/// отзыв» — со звездой, жёлтым цветом и попаданием в чужую вкладку фильтра.
/// Второй: при пропаже `created_at` дата подставляется текущим временем, и
/// уведомление недельной давности навсегда остаётся «Только что».
void main() {
  Map<String, dynamic> notificationRow({
    String type = 'new_review',
    String? createdAt = '2026-09-01T10:00:00.000Z',
  }) =>
      <String, dynamic>{
        'id': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'user_id': 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'type': type,
        'title': 'Новый отзыв',
        'message': 'Ирина оставила отзыв',
        'establishment_id': '11111111-1111-4111-8111-111111111111',
        'review_id': '33333333-3333-4333-8333-333333333333',
        'is_read': false,
        if (createdAt != null) 'created_at': createdAt,
      };

  group('Разбор уведомления', () {
    test('строка ответа разбирается целиком', () {
      final n = NotificationModel.fromJson(notificationRow());

      expect(n.id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
      expect(n.userId, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
      expect(n.type, NotificationType.newReview);
      expect(n.title, 'Новый отзыв');
      expect(n.message, 'Ирина оставила отзыв');
      expect(n.establishmentId, '11111111-1111-4111-8111-111111111111');
      expect(n.isRead, isFalse);
      expect(n.createdAt, DateTime.utc(2026, 9, 1, 10));
    });

    test('camelCase-ключи читаются наравне со snake_case', () {
      final n = NotificationModel.fromJson(<String, dynamic>{
        'id': 'x',
        'userId': 'u',
        'type': 'booking_confirmed',
        'title': 'Бронь подтверждена',
        'establishmentId': 'e',
        'isRead': true,
        'createdAt': '2026-09-01T10:00:00.000Z',
      });

      expect(n.userId, 'u');
      expect(n.establishmentId, 'e');
      expect(n.isRead, isTrue);
      expect(n.type, NotificationType.bookingConfirmed);
    });

    test('непрочитанность — состояние по умолчанию', () {
      // Направление важно: уведомление, по умолчанию прочитанное, не поднимет
      // бейдж, и партнёр не увидит новую бронь.
      final n = NotificationModel.fromJson(<String, dynamic>{
        'id': 'x',
        'type': 'booking_received',
        'created_at': '2026-09-01T10:00:00.000Z',
      });
      expect(n.isRead, isFalse);
    });

    test('ГРАНИЦА: без created_at уведомление считается сегодняшним', () {
      // Фиксация цены. Подстановка `DateTime.now()` делает любое уведомление
      // «Только что» — и старое, и новое, и это неотличимо от правды.
      final before = DateTime.now();
      final n = NotificationModel.fromJson(notificationRow(createdAt: null));

      expect(
        n.createdAt.isBefore(before.subtract(const Duration(seconds: 5))),
        isFalse,
        reason: 'дата подставлена текущим временем — возраст уведомления '
            'потерян безвозвратно',
      );
      expect(formatRelativeTime(n.createdAt), 'Только что');
    });
  });

  group('Типы уведомлений', () {
    // Зеркало канона типов и проверка на подмену неизвестного типа живут
    // в `test/config/vocabulary_canon_guard_test.dart`: это пространство
    // ключей, а не поведение модели. Здесь — только то, что делает сама
    // модель с уже разобранным типом.

    test('каждый тип приложения имеет иконку, цвет и раздел', () {
      // Полнота по перечислению: новый тип, добавленный без ветки в `icon`
      // или `color`, уронит этот тест, а не экран.
      for (final t in NotificationType.values) {
        final n = NotificationModel(
          id: 'x',
          userId: 'u',
          type: t,
          title: 't',
          isRead: false,
          createdAt: DateTime.utc(2026, 9, 1),
        );
        expect(n.icon, isNotNull, reason: 'нет иконки у ${t.name}');
        expect(n.color, isNotNull, reason: 'нет цвета у ${t.name}');
        expect(n.category, isNotNull, reason: 'нет раздела у ${t.name}');
      }
    });

    test('отзывные типы лежат в разделе отзывов', () {
      expect(
        NotificationType.partnerResponse.name,
        'partnerResponse',
      );
      for (final t in [
        NotificationType.partnerResponse,
        NotificationType.reviewHidden,
        NotificationType.reviewDeleted,
      ]) {
        final n = NotificationModel(
          id: 'x', userId: 'u', type: t, title: 't',
          isRead: false, createdAt: DateTime.utc(2026, 9, 1),
        );
        expect(n.category, NotificationCategory.reviews,
            reason: '${t.name} ушёл не в тот раздел');
      }
    });

    test('брони и заведения лежат в разделе заведений', () {
      for (final t in [
        NotificationType.bookingReceived,
        NotificationType.establishmentApproved,
        NotificationType.menuParsed,
        NotificationType.promotionNew,
      ]) {
        final n = NotificationModel(
          id: 'x', userId: 'u', type: t, title: 't',
          isRead: false, createdAt: DateTime.utc(2026, 9, 1),
        );
        expect(n.category, NotificationCategory.establishments,
            reason: '${t.name} ушёл не в тот раздел');
      }
    });
  });

  group('Русские относительные даты', () {
    // Даты задаются сдвигом от текущего момента: `formatRelativeTime` читает
    // часы машины сама, и другого входа у неё нет. Сдвиги взяты с запасом от
    // границ (61 секунда, а не 60), чтобы прогон не зависел от того, сколько
    // миллисекунд прошло между построением аргумента и вызовом.
    DateTime ago(Duration d) => DateTime.now().subtract(d);

    test('меньше минуты — «Только что»', () {
      expect(formatRelativeTime(ago(const Duration(seconds: 5))), 'Только что');
    });

    test('склонение минут: 1, 2, 5, 11, 21', () {
      expect(formatRelativeTime(ago(const Duration(minutes: 1, seconds: 5))),
          '1 минуту назад');
      expect(formatRelativeTime(ago(const Duration(minutes: 2, seconds: 5))),
          '2 минуты назад');
      expect(formatRelativeTime(ago(const Duration(minutes: 5, seconds: 5))),
          '5 минут назад');
      expect(formatRelativeTime(ago(const Duration(minutes: 11, seconds: 5))),
          '11 минут назад',
          reason: 'одиннадцать — исключение из правила «оканчивается на 1»');
      expect(formatRelativeTime(ago(const Duration(minutes: 21, seconds: 5))),
          '21 минуту назад');
    });

    test('склонение часов: 1, 3, 5, 11, 21', () {
      expect(formatRelativeTime(ago(const Duration(hours: 1, minutes: 1))),
          '1 час назад');
      expect(formatRelativeTime(ago(const Duration(hours: 3, minutes: 1))),
          '3 часа назад');
      expect(formatRelativeTime(ago(const Duration(hours: 5, minutes: 1))),
          '5 часов назад');
      expect(formatRelativeTime(ago(const Duration(hours: 11, minutes: 1))),
          '11 часов назад');
      expect(formatRelativeTime(ago(const Duration(hours: 21, minutes: 1))),
          '21 час назад');
    });

    test('склонение дней: 2, 5', () {
      expect(formatRelativeTime(ago(const Duration(days: 2, hours: 1))),
          '2 дня назад');
      expect(formatRelativeTime(ago(const Duration(days: 5, hours: 1))),
          '5 дней назад');
    });

    test('старше недели — дата с русским месяцем в родительном падеже', () {
      expect(formatRelativeTime(DateTime(2026, 3, 8)), '8 марта');
      expect(formatRelativeTime(DateTime(2026, 1, 1)), '1 января');
      expect(formatRelativeTime(DateTime(2025, 12, 31)), '31 декабря');
    });

    test('все двенадцать месяцев подписаны и не повторяются', () {
      final names = <String>[];
      for (var m = 1; m <= 12; m++) {
        final label = formatRelativeTime(DateTime(2025, m, 15));
        expect(label, startsWith('15 '));
        names.add(label.substring(3));
      }
      expect(names.toSet(), hasLength(12), reason: 'месяцы повторяются');
      expect(names.first, 'января');
      expect(names.last, 'декабря');
    });
  });
}
