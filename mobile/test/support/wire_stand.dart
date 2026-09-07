import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/services/api_client.dart';

/// Стенд для проверок НИЖЕ границы сервиса.
///
/// **Зачем ниже.** Фейк, реализующий интерфейс сервиса (как
/// `test/support/fake_api_client.dart`), отдаёт уже собранный объект и потому
/// прячет ровно тот слой, где живут отказы этой сессии: разбор конверта,
/// имена ключей пагинации, приведение типов. Тридцать тестов поверх такого
/// фейка остались бы зелёными при переименовании поля на бэкенде. Здесь
/// подменяется транспорт, и код сервиса исполняется целиком.
///
/// **Как устроено.** Все 13 сервисов mobile — жёсткие синглтоны, которые в
/// конструкторе берут `ApiClient()`, тоже синглтон. Публичного `withClient`
/// у них нет, и заводить его не понадобилось: `ApiClient` отдаёт свой `Dio`
/// наружу, а у `Dio` транспорт — изменяемое поле. Подмена
/// `httpClientAdapter` на единственном экземпляре делает подставными сразу
/// все сервисы, без единой правки `lib/`.
///
/// **Цена подмены — глобальность.** Экземпляр один на процесс, поэтому
/// [installWireStand] обязан вызываться в `setUp`, а не в теле теста, и сам
/// возвращает всё на место в `tearDown`. Иначе следующий файл набора получит
/// чужой транспорт.
class StubAdapter implements HttpClientAdapter {
  StubAdapter(this.respond);

  /// Ответ строится по запросу — так тест видит, ЧТО именно ушло на провод.
  final ResponseBody Function(RequestOptions options) respond;

  /// Все запросы по порядку. Проверять `requests.single`, когда запрос обязан
  /// быть ровно один: лишний вызов — это тоже дефект.
  final List<RequestOptions> requests = [];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
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

/// Канал защищённого хранилища. Перехватчик запросов `ApiClient` читает из
/// него `access_token` на КАЖДОМ запросе; без мока канал не зарегистрирован и
/// запрос падает `MissingPluginException` ещё до транспорта.
const _storageChannel =
    MethodChannel('plugins.it_nomads.com/flutter_secure_storage');

/// Ставит подставной транспорт на синглтон `ApiClient` и глушит хранилище.
///
/// Вызывать из `setUp`. Возвращает адаптер, чтобы тест мог прочитать
/// `requests`. Восстановление регистрируется через [addTearDown] — прежний
/// транспорт возвращается на место даже если тест упал.
StubAdapter installWireStand(
  ResponseBody Function(RequestOptions options) respond, {
  /// Что отдаёт защищённое хранилище на `read`. `null` = токена нет.
  String? accessToken,
}) {
  TestWidgetsFlutterBinding.ensureInitialized();

  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  messenger.setMockMethodCallHandler(_storageChannel, (call) async {
    if (call.method == 'read') return accessToken;
    if (call.method == 'readAll') return <String, String>{};
    return null;
  });

  final dio = ApiClient().dio;
  final previous = dio.httpClientAdapter;
  final adapter = StubAdapter(respond);
  dio.httpClientAdapter = adapter;

  addTearDown(() {
    dio.httpClientAdapter = previous;
    messenger.setMockMethodCallHandler(_storageChannel, null);
  });

  return adapter;
}
