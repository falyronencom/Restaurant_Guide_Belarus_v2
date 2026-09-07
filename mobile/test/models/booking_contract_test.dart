import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/models/booking.dart';
import 'package:restaurant_guide_mobile/models/booking_settings.dart';

/// Контракт провода для броней и их настроек.
///
/// Бронь — единственное место, где мобильное приложение показывает гостю
/// точное время и дату. Ошибка здесь не выглядит ошибкой: «7 апреля, 21:00»
/// читается одинаково правдоподобно и когда это правда, и когда месяц взят
/// не из той позиции строки.
void main() {
  Map<String, dynamic> bookingRow({
    String status = 'pending',
    String date = '2026-04-07',
    String time = '21:00:00',
    String? expiresAt = '2026-04-06T18:00:00.000Z',
  }) =>
      <String, dynamic>{
        'id': 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        'establishment_id': '11111111-1111-4111-8111-111111111111',
        'user_id': '88888888-8888-4888-8888-888888888888',
        'booking_date': date,
        'booking_time': time,
        'guest_count': 4,
        'comment': 'У окна',
        'contact_phone': '+375291234567',
        'status': status,
        if (expiresAt != null) 'expires_at': expiresAt,
        'created_at': '2026-04-05T12:00:00.000Z',
        'updated_at': '2026-04-05T12:00:00.000Z',
        'user_name': 'Ирина',
        'establishment_name': 'Васильки',
      };

  group('Разбор брони', () {
    test('строка ответа разбирается целиком', () {
      final b = Booking.fromJson(bookingRow());

      expect(b.id, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
      expect(b.guestCount, 4);
      expect(b.comment, 'У окна');
      expect(b.contactPhone, '+375291234567');
      expect(b.status, 'pending');
      expect(b.userName, 'Ирина');
      expect(b.establishmentName, 'Васильки');
      expect(b.expiresAt, DateTime.utc(2026, 4, 6, 18));
    });

    test('camelCase-ключи читаются наравне со snake_case', () {
      final b = Booking.fromJson(<String, dynamic>{
        'id': 'x',
        'establishmentId': 'e',
        'userId': 'u',
        'bookingDate': '2026-04-07',
        'bookingTime': '21:00',
        'guestCount': 2,
        'contactPhone': '+375291112233',
      });

      expect(b.establishmentId, 'e');
      expect(b.userId, 'u');
      expect(b.bookingDate, '2026-04-07');
      expect(b.guestCount, 2);
      expect(b.contactPhone, '+375291112233');
    });

    test('число гостей по умолчанию — один, а не ноль', () {
      // Ноль гостей — невозможная бронь; её показ означал бы, что где-то
      // потеряли поле, а не что гостей нет.
      final b = Booking.fromJson(<String, dynamic>{'id': 'x'});
      expect(b.guestCount, 1);
    });

    test('статус по умолчанию — ожидание, а не подтверждение', () {
      // Направление важно: тихое «подтверждена» показало бы гостю, что стол
      // за ним закреплён, когда партнёр ещё ничего не ответил.
      final b = Booking.fromJson(<String, dynamic>{'id': 'x'});
      expect(b.status, 'pending');
      expect(b.isConfirmed, isFalse);
    });
  });

  group('Состояния брони', () {
    test('каждый статус бэкенда даёт свой предикат', () {
      expect(Booking.fromJson(bookingRow(status: 'pending')).isPending, isTrue);
      expect(Booking.fromJson(bookingRow(status: 'confirmed')).isConfirmed,
          isTrue);
      expect(
          Booking.fromJson(bookingRow(status: 'declined')).isDeclined, isTrue);
      expect(Booking.fromJson(bookingRow(status: 'cancelled')).isCancelled,
          isTrue);
      expect(Booking.fromJson(bookingRow(status: 'expired')).isExpired, isTrue);
      expect(Booking.fromJson(bookingRow(status: 'no_show')).isNoShow, isTrue);
      expect(Booking.fromJson(bookingRow(status: 'completed')).isCompleted,
          isTrue);
    });

    test('активна только ожидающая или подтверждённая', () {
      expect(Booking.fromJson(bookingRow(status: 'pending')).isActive, isTrue);
      expect(
          Booking.fromJson(bookingRow(status: 'confirmed')).isActive, isTrue);
      for (final s in ['declined', 'cancelled', 'expired', 'no_show',
        'completed']) {
        expect(Booking.fromJson(bookingRow(status: s)).isActive, isFalse,
            reason: '«$s» не может быть активной бронью');
      }
    });

    test('русские подписи статусов не повторяются', () {
      const statuses = ['pending', 'confirmed', 'declined', 'cancelled',
        'expired', 'no_show', 'completed'];
      final labels =
          statuses.map((s) => Booking.fromJson(bookingRow(status: s))
              .statusLabel).toList();

      expect(labels, ['Ожидает', 'Подтверждена', 'Отклонена', 'Отменена',
        'Истекла', 'Неявка', 'Завершена']);
      expect(labels.toSet(), hasLength(statuses.length),
          reason: 'две разные брони с одной подписью неразличимы на экране');
    });

    test('неизвестный статус показывается как есть, а не как «Ожидает»', () {
      // Машинный код на экране — плохо, но подмена на «Ожидает» хуже: она
      // выглядит осмысленной.
      expect(Booking.fromJson(bookingRow(status: 'refunded')).statusLabel,
          'refunded');
    });

    test('скоро истекает — только для ожидающей и только внутри часа', () {
      final soon = Booking.fromJson(bookingRow(
        expiresAt:
            DateTime.now().add(const Duration(minutes: 30)).toIso8601String(),
      ));
      expect(soon.isExpiringSoon, isTrue);

      final later = Booking.fromJson(bookingRow(
        expiresAt:
            DateTime.now().add(const Duration(hours: 5)).toIso8601String(),
      ));
      expect(later.isExpiringSoon, isFalse);

      final past = Booking.fromJson(bookingRow(
        expiresAt:
            DateTime.now().subtract(const Duration(minutes: 5)).toIso8601String(),
      ));
      expect(past.isExpiringSoon, isFalse,
          reason: 'уже истекла — предупреждать не о чем');

      final confirmed = Booking.fromJson(bookingRow(
        status: 'confirmed',
        expiresAt:
            DateTime.now().add(const Duration(minutes: 30)).toIso8601String(),
      ));
      expect(confirmed.isExpiringSoon, isFalse,
          reason: 'подтверждённая бронь не истекает');
    });
  });

  group('Отображение даты и времени', () {
    test('день и месяц берутся из своих позиций, а не наоборот', () {
      // 2026-04-07 — седьмое апреля. Перестановка даёт «4 июля»: столь же
      // правдоподобную дату, по которой гость придёт не в тот день.
      expect(Booking.fromJson(bookingRow(date: '2026-04-07')).formattedDate,
          '7 апреля');
      expect(Booking.fromJson(bookingRow(date: '2026-12-31')).formattedDate,
          '31 декабря');
      expect(Booking.fromJson(bookingRow(date: '2026-01-01')).formattedDate,
          '1 января');
    });

    test('год показывается, только если он не текущий', () {
      final nextYear = DateTime.now().year + 1;
      expect(
        Booking.fromJson(bookingRow(date: '$nextYear-04-07')).formattedDate,
        '7 апреля $nextYear',
      );

      final thisYear = DateTime.now().year;
      expect(
        Booking.fromJson(bookingRow(date: '$thisYear-04-07')).formattedDate,
        '7 апреля',
      );
    });

    test('секунды из времени срезаются', () {
      expect(Booking.fromJson(bookingRow(time: '21:00:00')).formattedTime,
          '21:00');
      expect(
          Booking.fromJson(bookingRow(time: '09:30')).formattedTime, '09:30');
    });

    test('нераспознанное время показывается как пришло', () {
      expect(Booking.fromJson(bookingRow(time: 'вечером')).formattedTime,
          'вечером');
    });
  });

  group('Настройки брони', () {
    test('строка ответа разбирается целиком', () {
      final s = BookingSettings.fromJson(<String, dynamic>{
        'id': 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        'establishment_id': '11111111-1111-4111-8111-111111111111',
        'is_enabled': true,
        'max_guests_per_booking': 12,
        'confirmation_timeout_hours': 6,
        'max_days_ahead': 14,
        'min_hours_before': 3,
        'created_at': '2026-04-01T09:00:00.000Z',
        'updated_at': '2026-04-01T09:00:00.000Z',
      });

      expect(s.isEnabled, isTrue);
      expect(s.maxGuestsPerBooking, 12);
      expect(s.confirmationTimeoutHours, 6);
      expect(s.maxDaysAhead, 14);
      expect(s.minHoursBefore, 3);
    });

    test('бронирование выключено по умолчанию', () {
      // Направление важно: включённая по умолчанию бронь показала бы гостю
      // кнопку у заведения, которое броней не принимает и на них не ответит.
      final s = BookingSettings.fromJson(<String, dynamic>{'id': 'x'});
      expect(s.isEnabled, isFalse);
    });

    test('умолчания числовых настроек различимы между собой', () {
      final s = BookingSettings.fromJson(<String, dynamic>{'id': 'x'});
      expect(s.maxGuestsPerBooking, 10);
      expect(s.confirmationTimeoutHours, 4);
      expect(s.maxDaysAhead, 7);
      expect(s.minHoursBefore, 2);
    });
  });
}
