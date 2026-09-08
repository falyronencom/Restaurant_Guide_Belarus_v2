import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/config/analytics_vocabulary.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/widgets/moderation/status_dot.dart';

// Полнота словарей аналитики.
//
// Сторож здесь настоящий, а не копия набора рядом с проверкой: канон статусов
// один и доступен напрямую — `kEstablishmentStatuses`, повторяющий
// CHECK-ограничение `establishments.status`. Появится статус там, а здесь нет —
// тест упадёт, вместо того чтобы показать модератору машинный код.

void main() {
  group('Статусы', () {
    test('набор совпадает с каноном статусов заведения', () {
      expect(
        kStatusShares.keys.toSet(),
        kEstablishmentStatuses.keys.toSet(),
      );
    });

    test('подписи во множественном числе — величина счётная', () {
      // Единственное число здесь было бы ошибкой смысла: «Приостановлен 11»
      // читается как состояние одного заведения, а не как их количество.
      expect(statusShareLabel('active'), 'Активные');
      expect(statusShareLabel('suspended'), 'Приостановленные');
      expect(statusShareLabel('draft'), 'Черновики');
    });

    test('незнакомый код виден как есть, а не прячется', () {
      expect(statusShareLabel('flagged'), 'flagged');
    });

    test('цвет кодирует присутствие в каталоге, а не вердикт', () {
      // Видно посетителю.
      expect(statusShareColor('active'), AppTheme.statusGreen);
      // Ждёт нашей работы.
      expect(statusShareColor('pending'), AppTheme.primaryOrange);
      // Убрано решением модератора — отказ и приостановка равны по направлению,
      // хотя `StatusDot` даёт им разные цвета: там вопрос другой.
      expect(statusShareColor('rejected'), AppTheme.errorRed);
      expect(statusShareColor('suspended'), AppTheme.errorRed);
      // Публичным не было.
      expect(statusShareColor('draft'), AppTheme.textGrey);
      expect(statusShareColor('archived'), AppTheme.textGrey);
    });

    test('незнакомому коду направление не выдумывается', () {
      expect(statusShareColor('flagged'), AppTheme.textGrey);
    });

    test('порядок канонический — от видимого к непубликовавшемуся', () {
      // Порядок несёт смысл шкалы; сортировка по количеству перекладывала бы
      // полосу при каждом изменении данных.
      expect(
        kStatusShares.keys.toList(),
        <String>['active', 'pending', 'rejected', 'suspended', 'draft', 'archived'],
      );
    });
  });

  group('Роли', () {
    test('у каждой роли есть подпись и цвет', () {
      for (final role in kUserRoles.keys) {
        expect(kUserRoleColors[role], isNotNull, reason: 'нет цвета у $role');
      }
      expect(kUserRoles.keys.toSet(), kUserRoleColors.keys.toSet());
    });

    test('набор совпадает с CHECK-ограничением users.role', () {
      // ЧЕСТНАЯ ГРАНИЦА: это КОПИЯ набора, а не сверка с источником. У
      // статусов сторож настоящий — `kEstablishmentStatuses` доступен из того
      // же кода. Роли живут только в БД (`users_role_check` в
      // production_schema.sql), и появление новой роли ТАМ этот тест не
      // заметит. Он ловит другое: молчаливое расширение словаря здесь без
      // сверки с базой.
      // `viewer` — миграция 034 (роль панели «только просмотр»).
      expect(
        kUserRoles.keys.toList(),
        <String>['user', 'partner', 'admin', 'viewer'],
      );
    });

    test('ключи — то, что лежит в базе', () {
      expect(userRoleLabel('user'), 'Пользователи');
      expect(userRoleLabel('partner'), 'Партнёры');
      expect(userRoleLabel('admin'), 'Администраторы');
      expect(userRoleLabel('viewer'), 'Наблюдатели');
    });

    test('незнакомая роль видна как есть', () {
      expect(userRoleLabel('moderator'), 'moderator');
      expect(userRoleColor('moderator'), AppTheme.textGrey);
    });
  });
}
