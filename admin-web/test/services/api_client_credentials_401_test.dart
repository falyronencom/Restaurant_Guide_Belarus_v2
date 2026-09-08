import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/services/api_client.dart';
import 'package:restaurant_guide_admin_web/services/session_events.dart';

/// 401 на запросах за учётными данными — отказ, а не истёкшая сессия.
///
/// Перехватчик клиента отвечает одним кодом ответа за две разные вещи:
/// защищённый запрос получил 401 — надо обновить токен, а если нечем,
/// сообщить провайдеру об истёкшей сессии; сам вход или само обновление
/// получили 401 — учётные данные не приняты, и обновлять нечего. До правки
/// обе шли одной веткой: опечатавшийся видел «Ошибку входа. Попробуйте
/// снова» вместо «Неверный email или пароль», а просроченный refresh-токен
/// запускал обновление заново из собственного 401 — до 429 от сервера.
///
/// Транспорт подставной, хранилище — карта в памяти за каналом плагина:
/// перехватчики читают и чистят токены через него.
class _StubAdapter implements HttpClientAdapter {
  _StubAdapter(this.respond);

  final ResponseBody Function(RequestOptions options) respond;
  final List<RequestOptions> requests = [];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    // Ограничитель, а не ожидание: без него старый перехватчик крутил бы
    // обновление из собственного 401 до бесконечности, и тест не падал бы,
    // а висел.
    if (requests.length > 8) {
      throw StateError('транспорт зациклился: ${requests.length} запросов');
    }
    return respond(options);
  }

  @override
  void close({bool force = false}) {}
}

ResponseBody _json(Map<String, dynamic> body, int status) =>
    ResponseBody.fromString(
      jsonEncode(body),
      status,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );

Map<String, dynamic> _rejected(String code, String message) => {
      'success': false,
      'error': {'code': code, 'message': message},
    };

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const storageChannel =
      MethodChannel('plugins.it_nomads.com/flutter_secure_storage');
  final storage = <String, String>{};
  var expired = 0;

  setUp(() {
    storage.clear();
    expired = 0;
    SessionEvents.debugReset();
    SessionEvents.expired.listen((_) => expired++);
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(storageChannel, (call) async {
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
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(storageChannel, null);
  });

  ApiClient client(_StubAdapter adapter) {
    final dio = Dio(BaseOptions(baseUrl: 'https://stub.invalid'))
      ..httpClientAdapter = adapter;
    return ApiClient.withDio(dio);
  }

  Future<Object?> failure(Future<Response<dynamic>> request) =>
      request.then<Object?>((_) => null, onError: (Object e) => e);

  test('401 на входе: ответ сервера как есть, без обновления и без сигнала',
      () async {
    final adapter = _StubAdapter(
      (_) => _json(
        _rejected('INVALID_CREDENTIALS', 'Invalid email/phone or password'),
        401,
      ),
    );
    final api = client(adapter);

    final error = await failure(api.post(
      '/api/v1/admin/auth/login',
      data: {'email': 'probe@example.com', 'password': 'typo'},
    ));

    expect(error, isA<DioException>());
    expect((error as DioException).error, 'Invalid email/phone or password',
        reason: 'провайдер переводит именно эту фразу в «Неверный email или '
            'пароль»; подмена текстом про повторный вход даёт общую ошибку');
    expect(
      adapter.requests.map((r) => r.uri.path).toList(),
      ['/api/v1/admin/auth/login'],
      reason: 'по отказу во входе обновлять токен нечем',
    );
    expect(expired, 0, reason: 'неудачный вход — не истёкшая сессия');
  });

  test('401 на защищённом запросе без refresh-токена: сессия истекла, сигнал один',
      () async {
    final adapter = _StubAdapter(
      (_) => _json(_rejected('TOKEN_EXPIRED', 'Token expired'), 401),
    );
    final api = client(adapter);

    final error = await failure(api.get('/api/v1/admin/badges'));

    expect((error as DioException).error,
        'Authentication failed. Please log in again.');
    expect(
      adapter.requests.map((r) => r.uri.path).toList(),
      ['/api/v1/admin/badges'],
    );
    expect(expired, 1);
  });

  test('просроченный refresh-токен: одно обновление, не шторм', () async {
    storage['access_token'] = 'stale';
    storage['refresh_token'] = 'expired';
    final adapter = _StubAdapter(
      (_) => _json(
        _rejected('REFRESH_TOKEN_EXPIRED', 'Refresh token expired'),
        401,
      ),
    );
    final api = client(adapter);

    final error = await failure(api.get('/api/v1/admin/badges'));

    expect(error, isA<DioException>());
    expect(
      adapter.requests.map((r) => r.uri.path).toList(),
      ['/api/v1/admin/badges', '/api/v1/auth/refresh'],
      reason: '401 от самого обновления не должен запускать обновление снова',
    );
    expect(expired, 1);
    expect(storage.containsKey('access_token'), isFalse);
    expect(storage.containsKey('refresh_token'), isFalse);
  });
}
