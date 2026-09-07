import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/services/establishments_service.dart';

import '../support/wire_fixtures.dart';
import '../support/wire_stand.dart';

/// Проверки НИЖЕ границы сервиса — то, ради чего строился стенд.
///
/// Здесь исполняется настоящий код `EstablishmentsService`: сборка query,
/// разбор конверта и перекладка блока `pagination` в `meta`. Фейк уровня
/// сервиса всё это пропустил бы — он отдаёт уже собранный объект.
///
/// Самое ценное в файле — группа про пагинацию. Сервис переименовывает
/// `limit` → `per_page` и `totalPages` → `total_pages`, а недостающие
/// значения подставляет умолчаниями. Переименуй бэкенд `totalPages` — и
/// `total_pages` станет единицей: список замрёт на первой странице, кнопки
/// «дальше» не будет, ошибки не будет тоже. Ровно тот класс отказов, ради
/// которого написана эта сессия.
void main() {
  group('Поиск заведений', () {
    test('конверт data.establishments разбирается в список', () async {
      installWireStand((_) => jsonBody(searchEnvelope()));

      final result = await EstablishmentsService().searchEstablishments();

      expect(result.data, hasLength(1));
      expect(result.data.single.name, 'Васильки');
      expect(result.data.single.city, 'Минск');
    });

    test('страница и размер уходят в запрос', () async {
      final adapter = installWireStand((_) => jsonBody(searchEnvelope()));

      await EstablishmentsService()
          .searchEstablishments(page: 3, perPage: 50);

      final sent = adapter.requests.single;
      expect(sent.path, '/api/v1/search/establishments');
      expect(sent.queryParameters['page'], 3);
      expect(sent.queryParameters['limit'], 50,
          reason: 'бэкенд принимает размер страницы под именем limit');
    });

    test('фильтры уходят под теми именами, которые понимает бэкенд',
        () async {
      final adapter = installWireStand((_) => jsonBody(searchEnvelope()));

      await EstablishmentsService().searchEstablishments(
        city: 'Минск',
        categories: ['Бар', 'Паб'],
        cuisines: ['Японская'],
        priceRanges: [r'$$'],
        minRating: 4.0,
        search: 'драники',
        sortBy: 'rating',
        hoursFilter: 'until_22',
        features: ['wifi', 'terrace'],
      );

      final q = adapter.requests.single.queryParameters;
      expect(q['city'], 'Минск');
      expect(q['categories'], ['Бар', 'Паб']);
      expect(q['cuisines'], ['Японская']);
      expect(q['priceRange'], [r'$$']);
      expect(q['min_rating'], 4.0);
      expect(q['search'], 'драники');
      expect(q['sort_by'], 'rating');
      expect(q['hours_filter'], 'until_22');
      expect(q['features'], ['wifi', 'terrace']);
    });

    test('пустые фильтры не уходят в запрос вовсе', () async {
      // Пустой параметр — не то же самое, что отсутствующий: `features=`
      // ушёл бы в SQL как условие и обнулил выдачу.
      final adapter = installWireStand((_) => jsonBody(searchEnvelope()));

      await EstablishmentsService().searchEstablishments(
        categories: const [],
        features: const [],
        search: '',
      );

      final q = adapter.requests.single.queryParameters;
      expect(q.containsKey('categories'), isFalse);
      expect(q.containsKey('features'), isFalse);
      expect(q.containsKey('search'), isFalse);
    });

    test('координаты и радиус уходят вместе', () async {
      final adapter = installWireStand((_) => jsonBody(searchEnvelope()));

      await EstablishmentsService().searchEstablishments(
        latitude: 53.9023,
        longitude: 27.5619,
        maxDistance: 3.0,
      );

      final q = adapter.requests.single.queryParameters;
      expect(q['latitude'], 53.9023);
      expect(q['longitude'], 27.5619);
      expect(q['max_distance'], 3.0);
    });

    test('список из нескольких заведений сохраняет порядок бэкенда', () async {
      // Порядок — это результат сортировки на сервере. Перестановка на
      // клиенте выглядела бы как другая сортировка, а не как дефект.
      installWireStand((_) => jsonBody(searchEnvelope(establishments: [
            establishmentRow(id: 'a', name: 'Первое'),
            establishmentRow(id: 'b', name: 'Второе'),
            establishmentRow(id: 'c', name: 'Третье'),
          ])));

      final result = await EstablishmentsService().searchEstablishments();
      expect(result.data.map((e) => e.name), ['Первое', 'Второе', 'Третье']);
    });
  });

  group('Пагинация: перекладка имён', () {
    test('limit и totalPages бэкенда становятся per_page и total_pages',
        () async {
      installWireStand((_) => jsonBody(searchEnvelope(
            page: 2,
            limit: 20,
            total: 45,
            totalPages: 3,
          )));

      final result = await EstablishmentsService().searchEstablishments();

      expect(result.meta.page, 2);
      expect(result.meta.perPage, 20);
      expect(result.meta.total, 45);
      expect(result.meta.totalPages, 3);
    });

    test('ГРАНИЦА: переименование totalPages молча схлопывает список '
        'в одну страницу', () async {
      // Здесь фиксируется цена. Умолчание `?? 1` неотличимо от честного
      // ответа «страница всего одна»: экран покажет первые двадцать
      // заведений из сорока пяти, кнопки «дальше» не будет, и ни ошибки,
      // ни пустоты — ничего, на что можно пожаловаться.
      installWireStand((_) {
        final env = searchEnvelope(total: 45, totalPages: 3);
        final data = env['data'] as Map<String, dynamic>;
        data['pagination'] =
            renamed(data['pagination'] as Map<String, dynamic>,
                'totalPages', 'total_pages');
        return jsonBody(env);
      });

      final result = await EstablishmentsService().searchEstablishments();

      expect(result.meta.totalPages, 1,
          reason: 'подставлено умолчание вместо настоящих трёх страниц');
      expect(result.meta.total, 45,
          reason: 'при этом счётчик честно говорит про сорок пять — '
              'противоречие, которое на экране ничем не показывается');
    });

    test('ГРАНИЦА: переименование limit подменяет размер страницы', () async {
      installWireStand((_) {
        final env = searchEnvelope(limit: 50);
        final data = env['data'] as Map<String, dynamic>;
        data['pagination'] = renamed(
            data['pagination'] as Map<String, dynamic>, 'limit', 'per_page');
        return jsonBody(env);
      });

      final result = await EstablishmentsService().searchEstablishments();
      expect(result.meta.perPage, 20,
          reason: 'умолчание вместо запрошенных пятидесяти');
    });

    test('блока pagination нет вовсе — умолчания, а не исключение', () async {
      installWireStand((_) => jsonBody(<String, dynamic>{
            'success': true,
            'data': <String, dynamic>{
              'establishments': [establishmentRow()],
            },
          }));

      final result = await EstablishmentsService().searchEstablishments();

      expect(result.data, hasLength(1));
      expect(result.meta.page, 1);
      expect(result.meta.totalPages, 1);
    });

    test('переименование establishments даёт пустой список при живом счётчике',
        () async {
      installWireStand((_) {
        final env = searchEnvelope(total: 45);
        final data = env['data'] as Map<String, dynamic>;
        data['items'] = data.remove('establishments');
        return jsonBody(env);
      });

      final result = await EstablishmentsService().searchEstablishments();

      expect(result.data, isEmpty);
      expect(result.meta.total, 45,
          reason: 'экран покажет «ничего не найдено» при сорока пяти '
              'найденных — и это будет выглядеть исправным');
    });
  });

  group('Карточка заведения', () {
    test('конверт data разворачивается', () async {
      installWireStand((_) => jsonBody(<String, dynamic>{
            'success': true,
            'data': establishmentRow(name: 'Лидо'),
          }));

      final e = await EstablishmentsService()
          .getEstablishmentById('11111111-1111-4111-8111-111111111111');

      expect(e.name, 'Лидо');
    });

    test('ответ без обёртки data тоже разбирается', () async {
      installWireStand((_) => jsonBody(establishmentRow(name: 'Без обёртки')));

      final e = await EstablishmentsService().getEstablishmentById('x');
      expect(e.name, 'Без обёртки');
    });

    test('идентификатор попадает в путь, а не в параметры', () async {
      final adapter =
          installWireStand((_) => jsonBody(<String, dynamic>{
                'data': establishmentRow(),
              }));

      await EstablishmentsService().getEstablishmentById('abc-123');

      final sent = adapter.requests.single;
      expect(sent.path, '/api/v1/search/establishments/abc-123');
      expect(sent.queryParameters, isEmpty);
    });
  });

  group('Заголовок авторизации', () {
    test('токен из защищённого хранилища доезжает до запроса', () async {
      // Заодно доказывает, что перехватчик запросов в стенде живой: он
      // читает хранилище на каждом вызове, и без мока канала запрос не
      // дошёл бы до транспорта вовсе.
      final adapter = installWireStand(
        (_) => jsonBody(searchEnvelope()),
        accessToken: 'TOKEN-123',
      );

      await EstablishmentsService().searchEstablishments();

      expect(
        adapter.requests.single.headers['Authorization'],
        'Bearer TOKEN-123',
      );
    });

    test('без токена заголовка нет, а не пустой Bearer', () async {
      // Пустой `Bearer ` бэкенд отвергает как битый токен, и гость получил
      // бы 401 вместо честного анонимного доступа к каталогу.
      final adapter = installWireStand((_) => jsonBody(searchEnvelope()));

      await EstablishmentsService().searchEstablishments();

      expect(
        adapter.requests.single.headers.containsKey('Authorization'),
        isFalse,
      );
    });
  });

  group('Города', () {
    test('список городов разбирается из конверта data', () async {
      installWireStand((_) => jsonBody(<String, dynamic>{
            'success': true,
            'data': ['Минск', 'Гродно', 'Брест'],
          }));

      final cities = await EstablishmentsService().getAvailableCities();
      expect(cities, ['Минск', 'Гродно', 'Брест']);
    });

    test('ГРАНИЦА: отказ сервера подменяется зашитым списком', () async {
      // Ошибка проглатывается, и гость выбирает город из списка, который
      // сервер не подтверждал. Отличить это от рабочего ответа на экране
      // нечем — списки почти совпадают.
      installWireStand((_) => jsonBody(
            <String, dynamic>{'error': 'нет доступа'},
            status: 403,
          ));

      final cities = await EstablishmentsService().getAvailableCities();

      expect(cities, contains('Минск'));
      expect(cities, contains('Могилёв'),
          reason: 'зашитый список несёт «Могилёв» через ё — то самое '
              'написание, по которому поиск сравнивает строки точно');
    });
  });
}
