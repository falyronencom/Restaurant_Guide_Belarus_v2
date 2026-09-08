import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/models/establishment.dart';

// Проекция карточки заведения: два поля, добавленных ролью «только просмотр»
// (SDL CAT-C-2.11). Разбор `suspended_by` и `partner_data_redacted` не
// исполняется тестами экранов — их фейки отдают уже собранную модель.

Map<String, dynamic> _json({
  Map<String, dynamic>? suspendedBy,
  bool? redacted,
}) =>
    <String, dynamic>{
      'id': 'a41f9c02-1234-5678-9abc-def012345678',
      'partner_id': 'p-1',
      'name': 'Кухмістр',
      'status': 'suspended',
      'contact_person': redacted == true ? null : 'Иван Контактов',
      'contact_email': redacted == true ? null : 'contact@test.com',
      'registration_doc_url':
          redacted == true ? null : 'https://res.cloudinary.com/test/doc.pdf',
      if (suspendedBy != null) 'suspended_by': suspendedBy,
      if (redacted != null) 'partner_data_redacted': redacted,
    };

void main() {
  group('suspended_by', () {
    test('имя и время автора читаются из журнала', () {
      final detail = EstablishmentDetail.fromJson(_json(
        suspendedBy: <String, dynamic>{
          'id': 'u-1',
          'name': 'Сергей Админов',
          'at': '2026-09-08T10:15:00.000Z',
        },
      ));

      expect(detail.suspendedByName, 'Сергей Админов');
      expect(detail.suspendedByAt, DateTime.utc(2026, 9, 8, 10, 15));
    });

    test('null и отсутствие поля — автора нет', () {
      expect(EstablishmentDetail.fromJson(_json()).suspendedByName, isNull);
      expect(
        EstablishmentDetail.fromJson(
          <String, dynamic>{..._json(), 'suspended_by': null},
        ).suspendedByName,
        isNull,
      );
    });
  });

  group('partner_data_redacted', () {
    test('администратор: флаг снят, контакты на месте', () {
      final detail = EstablishmentDetail.fromJson(_json(redacted: false));

      expect(detail.partnerDataRedacted, isFalse);
      expect(detail.contactPerson, 'Иван Контактов');
      expect(detail.contactEmail, 'contact@test.com');
      expect(detail.registrationDocUrl, isNotNull);
    });

    test('просмотрщик: флаг поднят, контакты пусты', () {
      final detail = EstablishmentDetail.fromJson(_json(redacted: true));

      expect(detail.partnerDataRedacted, isTrue);
      expect(detail.contactPerson, isNull);
      expect(detail.contactEmail, isNull);
      expect(detail.registrationDocUrl, isNull);
    });

    test('старый сервер без поля читается как «не скрыто»', () {
      expect(EstablishmentDetail.fromJson(_json()).partnerDataRedacted, isFalse);
    });
  });
}
