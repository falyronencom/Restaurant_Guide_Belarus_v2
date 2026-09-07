import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/models/auth_response.dart';
import 'package:restaurant_guide_mobile/models/user.dart';

/// Контракт провода для учётной записи и входа.
///
/// Отдельная опасность этой поверхности: `AuthResponse` подставляет пустую
/// строку вместо отсутствующего токена. Пустой токен — это не «вход не
/// удался», а «вход как будто удался»: приложение переходит на главный экран,
/// а каждый следующий запрос получает 401. Гость видит не ошибку входа, а
/// приложение, которое «глючит».
void main() {
  Map<String, dynamic> userRow() => <String, dynamic>{
        'id': '88888888-8888-4888-8888-888888888888',
        'email': 'guest@example.by',
        'phone': null,
        'name': 'Ирина',
        'avatar_url': '/uploads/avatars/irina.jpg',
        'role': 'user',
        'email_verified': true,
        'phone_verified': false,
        'created_at': '2026-03-01T10:00:00.000Z',
        'updated_at': '2026-06-01T10:00:00.000Z',
      };

  group('Пользователь', () {
    test('строка ответа разбирается целиком', () {
      final u = User.fromJson(userRow());

      expect(u.id, '88888888-8888-4888-8888-888888888888');
      expect(u.email, 'guest@example.by');
      expect(u.name, 'Ирина');
      expect(u.role, 'user');
      expect(u.emailVerified, isTrue);
      expect(u.phoneVerified, isFalse);
      expect(u.createdAt, DateTime.utc(2026, 3, 1, 10));
    });

    test('camelCase-ключи читаются наравне со snake_case', () {
      final row = <String, dynamic>{
        'id': 'x',
        'emailVerified': true,
        'phoneVerified': true,
        'avatarUrl': '/a.jpg',
        'createdAt': '2026-03-01T10:00:00.000Z',
      };

      final u = User.fromJson(row);
      expect(u.emailVerified, isTrue);
      expect(u.phoneVerified, isTrue);
      expect(u.avatarUrl, '/a.jpg');
      expect(u.createdAt, DateTime.utc(2026, 3, 1, 10));
    });

    test('роль по умолчанию — обычный пользователь, а не партнёр', () {
      // Направление важно: роль решает, показывать ли партнёрские разделы.
      // Тихое повышение до партнёра открыло бы гостю чужой кабинет.
      final u = User.fromJson(<String, dynamic>{'id': 'x'});
      expect(u.role, 'user');
    });

    test('подтверждённость выводится из каналов, если флага нет', () {
      final onlyEmail = User.fromJson(<String, dynamic>{
        'id': 'x',
        'email_verified': true,
      });
      expect(onlyEmail.isVerified, isTrue);

      final neither = User.fromJson(<String, dynamic>{'id': 'x'});
      expect(neither.isVerified, isFalse);
    });

    test('явный флаг с бэкенда важнее вывода из каналов', () {
      final u = User.fromJson(<String, dynamic>{
        'id': 'x',
        'is_verified': false,
        'email_verified': true,
      });
      expect(u.isVerified, isFalse);
    });

    test('битая дата даёт null, а не исключение', () {
      final row = userRow();
      row['created_at'] = 'вчера';
      expect(User.fromJson(row).createdAt, isNull);
    });

    test('подпись пользователя: имя, иначе почта, иначе телефон', () {
      expect(User.fromJson(userRow()).displayName, 'Ирина');

      final noName = User.fromJson(<String, dynamic>{
        'id': 'x',
        'email': 'a@b.by',
      });
      expect(noName.displayName, 'a@b.by');

      final onlyPhone = User.fromJson(<String, dynamic>{
        'id': 'x',
        'phone': '+375291112233',
      });
      expect(onlyPhone.displayName, '+375291112233');

      // Порядок виден только когда есть ОБА канала: на пользователе с одной
      // почтой и на пользователе с одним телефоном перестановка `email ??
      // phone` проходит незамеченной.
      final both = User.fromJson(<String, dynamic>{
        'id': 'x',
        'email': 'a@b.by',
        'phone': '+375291112233',
      });
      expect(both.displayIdentifier, 'a@b.by',
          reason: 'почта — первичная подпись, телефон запасная');
    });

    test('относительный аватар достраивается, абсолютный — нет', () {
      expect(User.fromJson(userRow()).fullAvatarUrl, startsWith('http'));

      final abs = userRow();
      abs['avatar_url'] = 'https://cdn.example/i.jpg';
      expect(User.fromJson(abs).fullAvatarUrl, 'https://cdn.example/i.jpg');
    });

    test('пустая строка аватара — это отсутствие аватара', () {
      final row = userRow();
      row['avatar_url'] = '';
      expect(User.fromJson(row).fullAvatarUrl, isNull);
    });

    test('пользователи равны по идентификатору, а не по составу полей', () {
      final a = User.fromJson(userRow());
      final b = User.fromJson(userRow()..['name'] = 'Другое имя');
      expect(a, equals(b));
    });
  });

  group('Ответ входа', () {
    test('токены и пользователь разбираются', () {
      final r = AuthResponse.fromJson(<String, dynamic>{
        'access_token': 'AAA',
        'refresh_token': 'RRR',
        'user': userRow(),
      });

      expect(r.accessToken, 'AAA');
      expect(r.refreshToken, 'RRR');
      expect(r.user.name, 'Ирина');
    });

    test('camelCase-имена токенов тоже читаются', () {
      final r = AuthResponse.fromJson(<String, dynamic>{
        'accessToken': 'AAA',
        'refreshToken': 'RRR',
        'user': userRow(),
      });

      expect(r.accessToken, 'AAA');
      expect(r.refreshToken, 'RRR');
    });

    test('ГРАНИЦА: пропажа токена даёт пустую строку, а не отказ входа', () {
      // Здесь фиксируется цена, а не одобрение. Пустой токен неотличим от
      // настоящего для вызывающего кода: `AuthProvider` считает вход
      // удавшимся, экран меняется, и только следующий запрос получает 401 —
      // то есть отказ вылезает далеко от своей причины.
      final r = AuthResponse.fromJson(<String, dynamic>{'user': userRow()});

      expect(r.accessToken, isEmpty);
      expect(r.refreshToken, isEmpty);
      expect(
        r.accessToken.isEmpty,
        isTrue,
        reason: 'вызывающий код обязан проверять пустоту сам — модель не '
            'отличает «токена не дали» от «токен пустой»',
      );
    });

    test('ответ без вложенного user разбирается из корня', () {
      final r = AuthResponse.fromJson(<String, dynamic>{
        'access_token': 'AAA',
        'refresh_token': 'RRR',
        'id': '99999999-9999-4999-8999-999999999999',
        'name': 'Пётр',
      });

      expect(r.user.id, '99999999-9999-4999-8999-999999999999');
      expect(r.user.name, 'Пётр');
    });
  });

  group('Ответ регистрации', () {
    test('путь с подтверждением: токен проверки, прямых токенов нет', () {
      final r = RegisterResponse.fromJson(<String, dynamic>{
        'verification_token': 'VT',
        'email_sent': true,
        'expires_at': '2026-09-07T12:00:00.000Z',
      });

      expect(r.verificationToken, 'VT');
      expect(r.emailSent, isTrue);
      expect(r.expiresAt, DateTime.utc(2026, 9, 7, 12));
      expect(r.hasDirectAuth, isFalse);
    });

    test('путь с автовходом распознаётся по непустому токену', () {
      final r = RegisterResponse.fromJson(<String, dynamic>{
        'access_token': 'AAA',
        'refresh_token': 'RRR',
        'user': <String, dynamic>{'id': 'x'},
      });
      expect(r.hasDirectAuth, isTrue);
    });

    test('пустой токен автовходом НЕ считается', () {
      // Отличие пустой строки от null здесь и есть предмет проверки:
      // приложение иначе ушло бы на главный экран без права на запросы.
      final r = RegisterResponse.fromJson(<String, dynamic>{
        'access_token': '',
      });
      expect(r.hasDirectAuth, isFalse);
    });
  });
}
