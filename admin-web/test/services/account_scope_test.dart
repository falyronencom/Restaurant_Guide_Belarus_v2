import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/services/account_scope.dart';

void main() {
  setUp(AccountScope.debugReset);

  test('resetAll вызывает каждый зарегистрированный сброс один раз', () {
    var a = 0;
    var b = 0;
    AccountScope.register(() => a++);
    AccountScope.register(() => b++);

    AccountScope.resetAll();

    expect(a, 1);
    expect(b, 1);
  });

  test('resetAll без регистраций ничего не делает', () {
    expect(AccountScope.resetAll, returnsNormally);
  });

  test('зарегистрированные сбросы вызываются все вместе', () {
    final wiped = <String>[];
    AccountScope.register(() => wiped.add('moderation'));
    AccountScope.register(() => wiped.add('reviews'));
    AccountScope.register(() => wiped.add('audit'));

    AccountScope.resetAll();

    expect(wiped, unorderedEquals(<String>['moderation', 'reviews', 'audit']));
  });
}
