import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

/// Канал плагина защищённого хранилища.
const secureStorageChannel =
    MethodChannel('plugins.it_nomads.com/flutter_secure_storage');

/// Защищённое хранилище — карта в памяти за каналом плагина.
///
/// Стенд провода (`wire_stand.dart`) глушит канал без состояния: на любой
/// `read` один и тот же токен, `delete` ничего не делает. Для перехватчиков
/// этого мало: они пишут новые токены после обновления и стирают их после
/// провала, и именно это тест обязан увидеть. Здесь канал ведёт настоящую
/// карту; возвращается она же, чтобы тест мог и засеять её, и проверить.
///
/// Если нужны оба стенда, вызывать этот ПОСЛЕ `installWireStand`: последний
/// мок канала побеждает. Мок не снимается в `tearDown` по той же причине,
/// что и в стенде провода: запрос, переживший тест, упал бы
/// `MissingPluginException` и приписал падение следующему тесту. Каждый
/// тест ставит свою карту заново.
Map<String, String> installSecureStorageStand([Map<String, String>? seed]) {
  TestWidgetsFlutterBinding.ensureInitialized();
  final storage = <String, String>{...?seed};
  TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
      .setMockMethodCallHandler(secureStorageChannel, (call) async {
    final args = call.arguments as Map?;
    switch (call.method) {
      case 'read':
        return storage[args!['key'] as String];
      case 'write':
        storage[args!['key'] as String] = args['value'] as String;
        return null;
      case 'delete':
        storage.remove(args!['key'] as String);
        return null;
      case 'containsKey':
        return storage.containsKey(args!['key'] as String);
      case 'readAll':
        return Map<String, String>.of(storage);
      case 'deleteAll':
        storage.clear();
        return null;
    }
    return null;
  });
  return storage;
}
