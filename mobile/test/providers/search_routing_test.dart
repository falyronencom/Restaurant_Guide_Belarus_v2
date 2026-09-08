import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/models/filter_options.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/providers/smart_search_provider.dart';
import 'package:restaurant_guide_mobile/services/account_scope.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/wire_fixtures.dart';
import '../support/wire_stand.dart';

/// Какой ДВИЖОК выбирает провайдер и ЧТО он ему отдаёт.
///
/// Решение 07.09.2026: строка поиска на mobile всегда ищет умно. До него один и
/// тот же запрос давал на двух экранах разную выдачу — «капучино» находило 10
/// заведений на главной и 0 на экране результатов, — потому что экраны ходили в
/// разные эндпоинты. Здесь проверяется сама развилка и то, что фильтры экрана
/// переживают её в обе стороны.
///
/// Стенд стоит НИЖЕ границы сервиса (`test/support/wire_stand.dart`): фейк
/// уровня сервиса отдал бы уже собранный объект и молча пропустил бы и выбор
/// адреса, и имена полей в теле — ровно то, что здесь проверяется.
void main() {
  setUp(() {
    // `setCity` пишет выбор в SharedPreferences мимо ожидания результата;
    // без мока канал не зарегистрирован и запись валит тест исключением,
    // хотя к проверяемому поведению отношения не имеет.
    SharedPreferences.setMockInitialValues(<String, Object>{});
  });

  /// Тело POST-запроса, как его увидел провод.
  Map<String, dynamic> bodyOf(RequestOptions sent) =>
      sent.data as Map<String, dynamic>;

  group('Развилка движков', () {
    test('непустая строка уходит в умный поиск', () async {
      final adapter = installWireStand((_) => jsonBody(smartSearchEnvelope()));

      final provider = EstablishmentsProvider();
      provider.setSearchQuery('капучино');
      await provider.searchEstablishments();

      final sent = adapter.requests.single;
      expect(sent.method, 'POST');
      expect(sent.path, '/api/v1/search/smart');
      expect(bodyOf(sent)['query'], 'капучино');
      expect(provider.establishments, hasLength(1));
      expect(provider.error, isNull);
    });

    test('пустая строка уходит в классический просмотр по фильтрам', () async {
      final adapter = installWireStand((_) => jsonBody(searchEnvelope()));

      final provider = EstablishmentsProvider();
      provider.setSearchQuery(null);
      await provider.searchEstablishments();

      final sent = adapter.requests.single;
      expect(sent.method, 'GET');
      expect(sent.path, '/api/v1/search/establishments');
    });

    test('строка из одних пробелов — это пустая строка', () async {
      // Иначе пользователь, случайно нажавший пробел, платил бы вызовом модели
      // за запрос без единого слова.
      final adapter = installWireStand((_) => jsonBody(searchEnvelope()));

      final provider = EstablishmentsProvider();
      provider.setSearchQuery('   ');
      await provider.searchEstablishments();

      expect(adapter.requests.single.path, '/api/v1/search/establishments');
    });

    test('классический путь больше не шлёт search — фразу забрал умный', () async {
      // Ветка выбирается по той же фразе, поэтому непустой `search` в
      // query-строке означал бы, что развилка сломана.
      final adapter = installWireStand((_) => jsonBody(searchEnvelope()));

      final provider = EstablishmentsProvider();
      provider.setSearchQuery('');
      await provider.searchEstablishments();

      expect(adapter.requests.single.queryParameters.containsKey('search'),
          isFalse);
    });
  });

  group('Фильтры экрана переживают развилку', () {
    test('умный поиск получает фильтры теми же именами, что и классический',
        () async {
      final adapter = installWireStand((_) => jsonBody(smartSearchEnvelope()));

      final provider = EstablishmentsProvider();
      provider.setSearchQuery('пицца за 20 рублей');
      provider.setCity('Минск');
      provider.setPriceFilters({PriceRange.medium});
      provider.setHoursFilter(HoursFilter.until22);
      provider.toggleCategoryFilter('Ресторан');
      provider.toggleCuisineFilter('Итальянская');
      provider.toggleAmenityFilter('wifi');
      await provider.searchEstablishments();

      final body = bodyOf(adapter.requests.single);
      expect(body['city'], 'Минск');
      expect(body['priceRange'], [PriceRange.medium.apiValue]);
      expect(body['hours_filter'], HoursFilter.until22.apiValue);
      expect(body['categories'], ['Ресторан']);
      expect(body['cuisines'], ['Итальянская']);
      expect(body['features'], ['wifi']);
    });

    test('сортировка, которую пользователь не выбирал, в тело НЕ уходит',
        () async {
      // Умолчание «по рейтингу» (и автоподмена на «по расстоянию» после
      // выдачи GPS) — не выбор пользователя. Уйди оно как явный фильтр, по
      // правилу слияния оно побило бы сортировку, выведенную из фразы: на
      // «подешевле» превью главной (сортировку не шлёт вовсе) и список
      // разошлись бы в порядке, и три карточки превью перестали бы быть
      // первыми тремя списка.
      final adapter = installWireStand((_) => jsonBody(smartSearchEnvelope()));

      final provider = EstablishmentsProvider();
      provider.setSearchQuery('подешевле');
      await provider.searchEstablishments();

      expect(bodyOf(adapter.requests.single).containsKey('sort_by'), isFalse);
    });

    test('классический путь сортировку шлёт всегда — там спорить не с чем',
        () async {
      // Сохранённое поведение: без фразы никакой выведенной сортировки нет,
      // и порядок списка обязан совпадать с надписью на контроле.
      final adapter = installWireStand((_) => jsonBody(searchEnvelope()));

      final provider = EstablishmentsProvider();
      provider.setSearchQuery('');
      await provider.searchEstablishments();

      expect(adapter.requests.single.queryParameters['sort_by'], 'rating');
    });

    test('выбранная сортировка доезжает до умного поиска', () async {
      final adapter = installWireStand((_) => jsonBody(smartSearchEnvelope()));

      final provider = EstablishmentsProvider();
      // setSort сам запускает выборку — ждём её, иначе следующий вызов
      // упрётся в защиту от параллельного поиска и молча ничего не сделает.
      provider.setSort(SortOption.priceAsc);
      await pumpEventQueue();

      provider.setSearchQuery('кофе');
      await provider.searchEstablishments();

      expect(bodyOf(adapter.requests.last)['sort_by'], 'price_asc');
    });

    test('пустые наборы фильтров в тело не попадают вовсе', () async {
      // Пустой `priceRange` на бэкенде уходит в SQL как `= ANY('{}')` и
      // обнуляет выдачу (голая проверка истинности в `searchService`);
      // остальные списки там защищены `length > 0`, но правило держим общим.
      final adapter = installWireStand((_) => jsonBody(smartSearchEnvelope()));

      final provider = EstablishmentsProvider();
      provider.setSearchQuery('кофе');
      await provider.searchEstablishments();

      final body = bodyOf(adapter.requests.single);
      expect(body.containsKey('categories'), isFalse);
      expect(body.containsKey('cuisines'), isFalse);
      expect(body.containsKey('features'), isFalse);
      expect(body.containsKey('priceRange'), isFalse);
      expect(body.containsKey('hours_filter'), isFalse);
    });

    test('размер страницы явный: 20, а не превьюшные 3', () async {
      // У `searchSmart` умолчание limit = 3 — оно для превью на главной.
      // Забыть про него значило бы показать на экране результатов три карточки.
      final adapter = installWireStand((_) => jsonBody(smartSearchEnvelope()));

      final provider = EstablishmentsProvider();
      provider.setSearchQuery('кофе');
      await provider.searchEstablishments();

      expect(bodyOf(adapter.requests.single)['limit'], 20);
    });
  });

  group('Пагинация умной выдачи', () {
    test('вторая страница уходит в тот же эндпоинт с page: 2', () async {
      final adapter = installWireStand(
        (_) => jsonBody(smartSearchEnvelope(page: 1, limit: 20, total: 45)),
      );

      final provider = EstablishmentsProvider();
      provider.setSearchQuery('кофе');
      await provider.searchEstablishments();
      await provider.searchEstablishments(page: 2, append: true);

      expect(adapter.requests, hasLength(2));
      expect(adapter.requests.last.path, '/api/v1/search/smart');
      expect(bodyOf(adapter.requests.last)['page'], 2);
    });

    test('totalPages из ответа доезжает до провайдера — иначе список замрёт',
        () async {
      // `SmartSearchResult` раньше нёс только `total`; экран считает «есть ли
      // ещё» по `page < totalPages`, и единица означала бы конец списка.
      installWireStand(
        (_) => jsonBody(smartSearchEnvelope(page: 1, limit: 20, total: 45)),
      );

      final provider = EstablishmentsProvider();
      provider.setSearchQuery('кофе');
      await provider.searchEstablishments();

      expect(provider.paginationMeta?.totalPages, 3);
      expect(provider.paginationMeta?.perPage, 20);
      expect(provider.totalResults, 45);
      expect(provider.hasMorePages, isTrue);
    });

    test('последняя страница закрывает подгрузку', () async {
      installWireStand(
        (_) => jsonBody(
          smartSearchEnvelope(page: 3, limit: 20, total: 45, totalPages: 3),
        ),
      );

      final provider = EstablishmentsProvider();
      provider.setSearchQuery('кофе');
      await provider.searchEstablishments(page: 3);

      expect(provider.hasMorePages, isFalse);
    });
  });

  group('Разбор фразы и отказ AI', () {
    test('intent доезжает до провайдера', () async {
      installWireStand(
        (_) => jsonBody(smartSearchEnvelope(
          intent: smartIntent(dish: 'пицца', priceMax: 20),
        )),
      );

      final provider = EstablishmentsProvider();
      provider.setSearchQuery('пицца за 20 рублей');
      await provider.searchEstablishments();

      expect(provider.searchIntent?.dish, 'пицца');
      expect(provider.searchIntent?.priceMax, 20);
      expect(provider.searchFallback, isFalse);
    });

    test('признак отказа AI поднимается наверх', () async {
      installWireStand((_) => jsonBody(smartSearchEnvelope(fallback: true)));

      final provider = EstablishmentsProvider();
      provider.setSearchQuery('пицца');
      await provider.searchEstablishments();

      expect(provider.searchFallback, isTrue);
    });

    test('переход на классический путь сбрасывает разбор прошлой фразы',
        () async {
      // Иначе шапка «пицца · до 20 BYN» осталась бы висеть над выдачей,
      // собранной уже без фразы.
      installWireStand((options) => options.path.contains('smart')
          ? jsonBody(smartSearchEnvelope(
              intent: smartIntent(dish: 'пицца'), fallback: true))
          : jsonBody(searchEnvelope()));

      final provider = EstablishmentsProvider();
      provider.setSearchQuery('пицца');
      await provider.searchEstablishments();
      expect(provider.searchIntent?.dish, 'пицца');

      provider.setSearchQuery('');
      await provider.searchEstablishments();

      expect(provider.searchIntent, isNull);
      expect(provider.searchFallback, isFalse);
    });
  });

  group('Ошибки', () {
    test('429 объясняет, что ждать надо минуту', () async {
      // Умный поиск ограничен 30 запросами в минуту на IP. Общий текст
      // «попробуйте позже» не подсказывает, сколько ждать, а повтор сразу
      // упрётся в тот же лимит.
      installWireStand(
        (_) => jsonBody(
          <String, dynamic>{
            'success': false,
            'error': <String, dynamic>{'code': 'RATE_LIMIT_EXCEEDED'},
          },
          status: 429,
        ),
      );

      final provider = EstablishmentsProvider();
      provider.setSearchQuery('кофе');
      await provider.searchEstablishments();

      expect(provider.error, 'Слишком много запросов, подождите минуту');
      expect(provider.isLoading, isFalse);
    });

    test('429 на классическом пути срока не называет', () async {
      // Там действует глобальный часовой лимит, а не минутный лимит умного
      // поиска: совет «подождите минуту» врал бы в другую сторону.
      installWireStand(
        (_) => jsonBody(
          <String, dynamic>{
            'success': false,
            'error': <String, dynamic>{'code': 'RATE_LIMIT_EXCEEDED'},
          },
          status: 429,
        ),
      );

      final provider = EstablishmentsProvider();
      provider.setSearchQuery('');
      await provider.searchEstablishments();

      expect(provider.error, 'Слишком много запросов. Попробуйте позже.');
    });

    test('прочие отказы получают текст транспорта, а не общий английский',
        () async {
      // Правка 08.09: разбор ошибки в провайдере шёл по подстрокам в
      // `toString()` исключения — а `ApiClient` пересобирает DioException
      // без `message`, и ни статуса, ни слова с заглавной буквы там нет.
      // Почти всякий отказ доходил до общего запасного текста, и текст этот
      // был английским. Теперь разбор идёт по статусу и типу, а сообщение,
      // подготовленное транспортом (у него есть русская карта статусов),
      // доходит до гостя как есть.
      installWireStand(
        (_) => jsonBody(
          <String, dynamic>{
            'success': false,
            'error': <String, dynamic>{'code': 'BAD'},
          },
          status: 400,
        ),
      );

      final provider = EstablishmentsProvider();
      provider.setSearchQuery('кофе');
      await provider.searchEstablishments();

      expect(provider.error, 'Некорректный запрос. Проверьте введённые данные.');
    });
  });  group('Превью главной и список считают по одним фильтрам', () {
    /// Ставит на провайдере тот набор фильтров, который пользователь мог
    /// выставить на `/filter`, и возвращает его же.
    EstablishmentsProvider withFilters() {
      final provider = EstablishmentsProvider();
      provider.setCity('Минск');
      provider.setPriceFilters({PriceRange.medium});
      provider.setHoursFilter(HoursFilter.until22);
      provider.toggleCategoryFilter('Кофейня');
      provider.toggleCuisineFilter('Итальянская');
      provider.toggleAmenityFilter('wifi');
      return provider;
    }

    test('превью шлёт фильтры экрана, а не только фразу', () async {
      // До 07.09 превью получало лишь фразу, координаты и город: бейдж на
      // главной показывал «фильтров: 4», превью считалось без них, и кнопка
      // «Показать все (N)» обещала N, которого на следующем экране не было.
      final adapter = installWireStand((_) => jsonBody(smartSearchEnvelope()));

      final est = withFilters();
      await SmartSearchProvider()
          .executeSmartSearch('капучино', filters: est.screenFilters);

      final body = bodyOf(adapter.requests.single);
      expect(adapter.requests.single.path, '/api/v1/search/smart');
      expect(body['city'], 'Минск');
      expect(body['priceRange'], [PriceRange.medium.apiValue]);
      expect(body['hours_filter'], HoursFilter.until22.apiValue);
      expect(body['categories'], ['Кофейня']);
      expect(body['cuisines'], ['Итальянская']);
      expect(body['features'], ['wifi']);
    });

    test('превью и список несут ОДИН набор фильтров', () async {
      // Главная проверка этой правки: не «превью что-то шлёт», а «шлёт ровно
      // то же». Новая размерность, доехавшая до одного вызова и потерянная в
      // другом, снова разведёт счётчик N и состав следующего экрана.
      final adapter = installWireStand((_) => jsonBody(smartSearchEnvelope()));

      final est = withFilters();
      await SmartSearchProvider()
          .executeSmartSearch('капучино', filters: est.screenFilters);

      est.setSearchQuery('капучино');
      await est.searchEstablishments();

      expect(adapter.requests, hasLength(2));
      const dimensions = [
        'city', 'categories', 'cuisines', 'priceRange',
        'hours_filter', 'features', 'sort_by', 'max_distance',
      ];
      final preview = bodyOf(adapter.requests.first);
      final list = bodyOf(adapter.requests.last);
      for (final key in dimensions) {
        expect(preview[key], list[key], reason: 'размерность $key разошлась');
      }
      // Отличаться им положено только размером страницы.
      expect(preview['limit'], 3);
      expect(list['limit'], 20);
    });

    test('превью тоже не шлёт сортировку, которую не выбирали', () async {
      final adapter = installWireStand((_) => jsonBody(smartSearchEnvelope()));

      final est = EstablishmentsProvider();
      await SmartSearchProvider()
          .executeSmartSearch('кофе', filters: est.screenFilters);

      expect(bodyOf(adapter.requests.single).containsKey('sort_by'), isFalse);
    });

    test('выбранная сортировка доезжает и до превью', () async {
      final adapter = installWireStand((_) => jsonBody(smartSearchEnvelope()));

      final est = EstablishmentsProvider();
      est.setSort(SortOption.priceAsc);
      await pumpEventQueue();

      await SmartSearchProvider()
          .executeSmartSearch('кофе', filters: est.screenFilters);

      expect(bodyOf(adapter.requests.last)['sort_by'], 'price_asc');
    });
  });

  group('Смена аккаунта не оставляет чужую фразу', () {
    // Провайдеры живут в `main.dart` и переживают выход из аккаунта. Фраза —
    // ввод пользователя: следующий вошедший не должен видеть её ни на главной
    // (превью рисуется на ПЕРВОМ экране после входа), ни на экране
    // результатов, который перечитывает `searchQuery` в `initState`.
    setUp(AccountScope.debugReset);
    tearDown(AccountScope.debugReset);

    test('превью главной очищается вместе с разобранной фразой', () async {
      installWireStand((_) => jsonBody(smartSearchEnvelope(
            intent: smartIntent(dish: 'пицца'),
          )));

      final smart = SmartSearchProvider();
      addTearDown(smart.dispose);
      await smart.executeSmartSearch('пицца за 20 рублей');

      expect(smart.smartResults, isNotEmpty,
          reason: 'без выдачи проверка сброса ничего не докажет');
      expect(smart.lastQuery, 'пицца за 20 рублей');

      AccountScope.resetAll();

      expect(smart.smartResults, isEmpty);
      expect(smart.lastQuery, '');
      expect(smart.parsedIntent, isNull);
      expect(smart.totalResults, 0);
      expect(smart.state, SmartSearchState.idle);
    });

    test('фраза и её разбор уходят и из списка — иначе они вернутся одним тапом',
        () async {
      // Экран результатов в `initState` читает `searchQuery` и ищет по ней
      // заново. Очистить только превью значило бы починить симптом.
      installWireStand((_) => jsonBody(smartSearchEnvelope(
            intent: smartIntent(dish: 'пицца'),
          )));

      final est = EstablishmentsProvider();
      addTearDown(est.dispose);
      est.setSearchQuery('пицца за 20 рублей');
      await est.searchEstablishments();

      expect(est.searchQuery, 'пицца за 20 рублей');
      expect(est.searchIntent?.dish, 'пицца');

      AccountScope.resetAll();

      expect(est.searchQuery, isNull);
      expect(est.searchIntent, isNull);
      expect(est.searchFallback, isFalse);
    });

    test('город и фильтры каталога сброс переживают — они не принадлежат никому',
        () async {
      // Обратная сторона: вычистить заодно каталог значило бы сбрасывать
      // пользователю выбор города при каждом выходе из аккаунта.
      installWireStand((_) => jsonBody(searchEnvelope()));

      final est = EstablishmentsProvider();
      addTearDown(est.dispose);
      est.setCity('Минск');
      est.setPriceFilters({PriceRange.medium});
      est.setHoursFilter(HoursFilter.until22);

      AccountScope.resetAll();

      expect(est.selectedCity, 'Минск');
      expect(est.priceFilters, {PriceRange.medium});
      expect(est.hoursFilter, HoursFilter.until22);
    });
  });
}
