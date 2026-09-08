import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';

import '../support/wire_stand.dart';

/// Сторож языка сообщений об ошибке.
///
/// **Зачем сторож, а не разовая правка.** До 08.09.2026 гость видел
/// «Network error. Please check your internet connection.» и «An error
/// occurred. Please try again.» — по-английски, в русском приложении.
/// Текст ошибок правится по одной строке в разных местах (транспорт знает
/// про типы соединения, провайдер про статусы), и русифицированный набор
/// расходится ровно так же, как разошлись словари ключей: тихо и по частям.
/// Сторож ловит новую английскую строку в тот же день, когда её напишут.
///
/// **Отдельно: проверки по подстроке были мертвы.** Прежний разбор искал
/// в `toString()` исключения слова `Network`, `404`, `500`. `ApiClient`
/// пересобирает `DioException` без `message`, и ни кода статуса, ни слова
/// с заглавной буквы там нет — почти всякая ошибка доходила до общего
/// запасного текста. Поэтому проверки ниже смотрят не только на язык, но и
/// на то, что разные отказы дают РАЗНЫЕ сообщения: одинаковый текст на все
/// случаи и есть симптом мёртвого разбора.
void main() {
  /// Латиница в сообщении, кроме допустимых вкраплений.
  ///
  /// Пустой результат — сообщение на русском. Непустой — перечисляет
  /// найденные латинские куски, чтобы в отчёте о падении было видно, что
  /// именно просочилось.
  List<String> latinChunks(String message) =>
      RegExp(r'[A-Za-z]{2,}').allMatches(message).map((m) => m.group(0)!).toList();

  Future<String> errorFrom(
    ResponseBody Function(RequestOptions options) respond, {
    String? query,
  }) async {
    installWireStand(respond);
    final p = EstablishmentsProvider();
    addTearDown(p.dispose);
    if (query != null) p.setSearchQuery(query);
    await p.searchEstablishments();
    return p.error ?? '';
  }

  group('Сообщения об ошибке — по-русски', () {
    test('заведение не найдено', () async {
      final message = await errorFrom(
        (_) => jsonBody(<String, dynamic>{}, status: 404),
      );

      expect(latinChunks(message), isEmpty, reason: 'в тексте: $message');
      // Проверяется не только язык, но и МАРШРУТ. Транспорт на 404 отвечает
      // общим «Ресурс не найден.», провайдер уточняет до заведения. Без
      // этого утверждения снятие ветки провайдера проходит незамеченным:
      // текст остаётся русским, и сторож языка молчит.
      expect(message, contains('Заведение'),
          reason: 'ответ пришёл от транспорта, а не от разбора провайдера');
    });

    test('отказ, пришедший НЕ от Dio, тоже говорит по-русски', () async {
      // Сервис бросает обычное `Exception`, когда конверт не той формы —
      // например, вместо объекта пришёл массив. Эта ветка разбора не
      // покрывалась ничем: все прочие отказы приходят как DioException.
      final message = await errorFrom(
        (options) => ResponseBody.fromString(
          '[]',
          200,
          headers: {
            Headers.contentTypeHeader: [Headers.jsonContentType],
          },
        ),
      );

      expect(message, isNotEmpty);
      expect(latinChunks(message), isEmpty, reason: 'в тексте: $message');
    });

    test('ошибка сервера: повтор ограничен и текст про сервер', () async {
      // Транспорт повторяет 5xx с нарастающей паузой, но счётчик повторов
      // живёт в `extra` запроса. Пока `_retry` не переносил `extra`, счётчик
      // приходил нулевым, потолок не наступал никогда, и гость видел вечную
      // загрузку: ни ошибки, ни пустого экрана. Найдено 08.09 этим тестом —
      // он не упал, а завис на тридцати секундах.
      //
      // Поэтому проверяется в первую очередь ЧИСЛО запросов, а уже потом
      // текст: язык правильный и у сообщения, которое никто не увидит.
      var requests = 0;
      installWireStand((_) {
        requests++;
        return jsonBody(<String, dynamic>{}, status: 500);
      });
      final p = EstablishmentsProvider();
      addTearDown(p.dispose);

      await p.searchEstablishments();

      expect(requests, lessThanOrEqualTo(4),
          reason: 'исходный запрос плюс не больше трёх повторов');
      expect(p.error, isNotNull);
      expect(latinChunks(p.error!), isEmpty, reason: 'в тексте: ${p.error}');
      expect(p.error, contains('сервер'));
    });

    test('нет связи', () async {
      final message = await errorFrom((options) => throw DioException(
            requestOptions: options,
            type: DioExceptionType.connectionError,
          ));

      expect(latinChunks(message), isEmpty, reason: 'в тексте: $message');
      expect(message, contains('связ'),
          reason: 'отказ соединения не должен сваливаться в общий текст');
    });

    test('таймаут', () async {
      final message = await errorFrom((options) => throw DioException(
            requestOptions: options,
            type: DioExceptionType.receiveTimeout,
          ));

      expect(message, isNotEmpty);
      expect(latinChunks(message), isEmpty, reason: 'в тексте: $message');
    });

    test('слишком много запросов', () async {
      final message = await errorFrom(
        (_) => jsonBody(<String, dynamic>{}, status: 429),
      );

      expect(message, isNotEmpty);
      expect(latinChunks(message), isEmpty, reason: 'в тексте: $message');
    });

    test('запрос отклонён сервером', () async {
      final message = await errorFrom(
        (_) => jsonBody(<String, dynamic>{}, status: 403),
      );

      expect(message, isNotEmpty);
      expect(latinChunks(message), isEmpty, reason: 'в тексте: $message');
    });

    test('сообщение бэкенда доходит до гостя как есть', () async {
      // Бэкенд отвечает по-русски; клиент не имеет права подменять его
      // текст общей формулировкой — сервер знает про случай больше.
      final message = await errorFrom(
        (_) => jsonBody(<String, dynamic>{
          'error': <String, dynamic>{'message': 'Город указан неверно'},
        }, status: 400),
      );

      expect(message, 'Город указан неверно');
    });

    test('неудачное избранное сообщает по-русски', () async {
      installWireStand(
        (_) => jsonBody(<String, dynamic>{}, status: 403),
      );
      final p = EstablishmentsProvider();
      addTearDown(p.dispose);

      await p.toggleFavorite('abc');

      expect(p.error, isNotNull);
      expect(latinChunks(p.error!), isEmpty, reason: 'в тексте: ${p.error}');
    });
  });

  group('Разные отказы различимы', () {
    test('«не найдено» и «нет связи» — разный текст', () async {
      // Одинаковый текст на оба случая означал бы, что разбор снова мёртв и
      // всё сваливается в общий запасной вариант. Язык при этом был бы
      // правильным, и сторож языка один такого не заметил бы.
      final notFound = await errorFrom(
        (_) => jsonBody(<String, dynamic>{}, status: 404),
      );
      final offline = await errorFrom((options) => throw DioException(
            requestOptions: options,
            type: DioExceptionType.connectionError,
          ));

      expect(notFound, isNot(equals(offline)));
    });

    test('лимит запросов на умном пути называет срок, на обычном — нет',
        () async {
      // Умный поиск ограничен 30 запросами в минуту: за ним вызов модели.
      // Совет «подождите минуту» честен только там; на остальных путях
      // действует часовой лимит, и тот же совет врал бы.
      final smart = await errorFrom(
        (_) => jsonBody(<String, dynamic>{}, status: 429),
        query: 'драники',
      );
      final classic = await errorFrom(
        (_) => jsonBody(<String, dynamic>{}, status: 429),
      );

      expect(smart, isNot(equals(classic)));
      expect(smart, contains('минуту'));
      expect(latinChunks(smart), isEmpty);
    });
  });
}
