import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/services/api_client.dart';

/// Стенд для проверок НИЖЕ границы сервиса: подставной транспорт и
/// хранилище токенов картой в памяти.
///
/// Фейк, реализующий интерфейс сервиса, отдаёт уже собранный объект и
/// прячет ровно тот слой, где живут отказы этого класса: разбор конверта,
/// ветки перехватчика, порядок запросов. Здесь подменяется транспорт, а код
/// сервиса и перехватчиков исполняется целиком. Образец — mobile
/// `test/support/wire_stand.dart`; в admin-web синглтон патчить не нужно,
/// у клиента есть `ApiClient.withDio`.
class StubAdapter implements HttpClientAdapter {
  StubAdapter(this.respond, {this.maxRequests = 8});

  /// Ответ строится по запросу — так тест видит, ЧТО именно ушло на провод.
  final ResponseBody Function(RequestOptions options) respond;

  /// Ограничитель, а не ожидание: зацикленный перехватчик должен уронить
  /// тест, а не подвесить его.
  final int maxRequests;

  /// Все запросы по порядку. Проверять состав целиком: лишний вызов — тоже
  /// дефект.
  final List<RequestOptions> requests = [];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    if (requests.length > maxRequests) {
      throw StateError('транспорт зациклился: ${requests.length} запросов');
    }
    return respond(options);
  }

  @override
  void close({bool force = false}) {}
}

/// Тело JSON-ответа со статусом.
ResponseBody jsonBody(Map<String, dynamic> body, {int status = 200}) =>
    ResponseBody.fromString(
      jsonEncode(body),
      status,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );

/// Отказ в конверте бэкенда.
Map<String, dynamic> rejectedBody(String code, String message) => {
      'success': false,
      'error': {'code': code, 'message': message},
    };

/// Клиент поверх подставного транспорта.
ApiClient stubClient(StubAdapter adapter) {
  final dio = Dio(BaseOptions(baseUrl: 'https://stub.invalid'))
    ..httpClientAdapter = adapter;
  return ApiClient.withDio(dio);
}

const _storageChannel =
    MethodChannel('plugins.it_nomads.com/flutter_secure_storage');

/// Ставит карту в памяти за канал защищённого хранилища.
///
/// Перехватчики читают `access_token` на каждом запросе и чистят оба токена
/// при провале обновления — без мока канал не зарегистрирован, и запрос
/// падает до транспорта. Вызывать из `setUp`; снятие регистрируется через
/// [addTearDown].
Map<String, String> installSecureStorageStand({
  Map<String, String> initial = const {},
}) {
  TestWidgetsFlutterBinding.ensureInitialized();
  final storage = <String, String>{...initial};
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  messenger.setMockMethodCallHandler(_storageChannel, (call) async {
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
  addTearDown(() => messenger.setMockMethodCallHandler(_storageChannel, null));
  return storage;
}
