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
  StubAdapter(this.respond, {this.maxRequests});

  /// Ответ строится по запросу — так тест видит, ЧТО именно ушло на провод.
  final ResponseBody Function(RequestOptions options) respond;

  /// Ограничитель, а не ожидание: перехватчик, зациклившийся на «обновить
  /// и повторить», без него крутил бы транспорт до бесконечности, и тест
  /// не падал бы, а висел. `null` — без предела.
  final int? maxRequests;

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
    final limit = maxRequests;
    if (limit != null && requests.length > limit) {
      throw StateError('транспорт зациклился: ${requests.length} запросов, '
          'последний — ${options.uri.path}');
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

  // Транспорт возвращается на место, а мок канала хранилища НЕ снимается.
  //
  // Причина найдена мутацией собственного стенда: провайдер умеет запускать
  // работу без `await` — `setSort` сам зовёт поиск, чтобы список
  // перестроился по новому порядку. Такой запрос переживает конец теста и
  // доходит до перехватчика уже после `tearDown`; со снятым моком он падает
  // `MissingPluginException`, и падение приписывается СЛЕДУЮЩЕМУ тесту.
  // Диагноз уводит в сторону: виноватым выглядит тест, который ничего не
  // делал.
  //
  // Мок канала не несёт состояния между тестами и в каждом ставится заново,
  // а `flutter test` даёт каждому файлу свой изолят — значит оставить его
  // до конца прогона файла безопасно и дешевле, чем помнить про хвосты.
  addTearDown(() {
    dio.httpClientAdapter = previous;
  });

  return adapter;
}
