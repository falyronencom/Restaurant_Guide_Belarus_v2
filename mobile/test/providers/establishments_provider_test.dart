import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/config/cities.dart';
import 'package:restaurant_guide_mobile/models/filter_options.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/wire_fixtures.dart';
import '../support/wire_stand.dart';

/// Состояние гостевого поиска.
///
/// Класс отказов здесь другой, чем в контракте провода. Разбор ответа ломается
/// один раз и одинаково; состояние ломается **на переходе** — когда величину,
/// посчитанную под одни данные, читают под другими. Номер страницы, счётчик
/// результатов, набор фильтров и признак «есть ли ещё» живут дольше выдачи,
/// под которую их считали.
///
/// Поэтому почти каждая проверка ниже пампит переход A→B, а не одно
/// состояние. Тест, ставящий фильтр через провайдер и тут же его читающий,
/// дефекта этого класса не видит в принципе.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    // Город сохраняется в SharedPreferences «выстрелил и забыл»; без мока
    // канал не зарегистрирован и `setCity` роняет тест на ровном месте.
    SharedPreferences.setMockInitialValues(<String, Object>{});
  });

  /// Провайдер с подставным транспортом, отвечающим одним и тем же конвертом.
  EstablishmentsProvider providerWith({
    required Map<String, dynamic> Function(int page) envelope,
  }) {
    installWireStand((options) {
      final page = int.tryParse('${options.queryParameters['page']}') ?? 1;
      return jsonBody(envelope(page));
    });
    final p = EstablishmentsProvider();
    addTearDown(p.dispose);
    return p;
  }

  group('Страницы и подгрузка', () {
    test('первая страница заполняет и список, и счётчики', () async {
      final p = providerWith(
        envelope: (page) => searchEnvelope(
          establishments: [establishmentRow(id: 'a', name: 'Первое')],
          page: page,
          total: 45,
          totalPages: 3,
        ),
      );

      await p.searchEstablishments();

      expect(p.establishments, hasLength(1));
      expect(p.currentPage, 1);
      expect(p.totalResults, 45);
      expect(p.hasMorePages, isTrue);
      expect(p.isLoading, isFalse);
      expect(p.error, isNull);
    });

    test('до первого поиска страниц не загружено — ноль, а не единица',
        () async {
      // Единица означала бы «мы на первой странице», хотя не загружено
      // ничего. Разница видна только в этом состоянии — после первого
      // ответа номер приходит с провода.
      final p = providerWith(envelope: (_) => searchEnvelope());

      expect(p.currentPage, 0);
      expect(p.totalResults, 0);
      expect(p.hasMorePages, isFalse);
    });

    test('на последней странице подгружать больше нечего', () async {
      final p = providerWith(
        envelope: (page) => searchEnvelope(page: 3, total: 45, totalPages: 3),
      );

      await p.searchEstablishments(page: 3);

      expect(p.currentPage, 3);
      expect(p.hasMorePages, isFalse);
    });

    test('loadMore добавляет страницу, а не заменяет список', () async {
      // Переход A→B: список после второй страницы обязан содержать обе.
      // Проверка одного состояния этого не различает — замена выглядела бы
      // как «вторая страница загрузилась».
      final p = providerWith(
        envelope: (page) => searchEnvelope(
          establishments: [
            establishmentRow(id: 'p$page', name: 'Страница $page'),
          ],
          page: page,
          total: 45,
          totalPages: 3,
        ),
      );

      await p.searchEstablishments();
      expect(p.establishments.map((e) => e.name), ['Страница 1']);

      await p.loadMore();

      expect(p.establishments.map((e) => e.name),
          ['Страница 1', 'Страница 2']);
      expect(p.currentPage, 2);
    });

    test('loadMore на последней странице не идёт в сеть', () async {
      final adapter = installWireStand(
        (_) => jsonBody(searchEnvelope(page: 3, total: 45, totalPages: 3)),
      );
      final p = EstablishmentsProvider();
      addTearDown(p.dispose);

      await p.searchEstablishments(page: 3);
      expect(adapter.requests, hasLength(1));

      await p.loadMore();

      expect(adapter.requests, hasLength(1),
          reason: 'лишний запрос за несуществующей страницей');
    });

    test('два loadMore подряд дают один запрос, а не два', () async {
      // Повторный вход в подгрузку: список прокручен быстро, обработчик
      // сработал дважды. Без охраны обе попытки уходят в сеть и вторая
      // страница добавляется в список дважды.
      final adapter = installWireStand(
        (_) => jsonBody(searchEnvelope(
          establishments: [establishmentRow(id: 'x', name: 'Ещё')],
          page: 2,
          total: 45,
          totalPages: 3,
        )),
      );
      final p = EstablishmentsProvider();
      addTearDown(p.dispose);

      await p.searchEstablishments();
      final afterFirst = adapter.requests.length;

      // Намеренно без await у первого: так их и зовёт прокрутка.
      final a = p.loadMore();
      final b = p.loadMore();
      await Future.wait([a, b]);

      expect(adapter.requests.length - afterFirst, 1,
          reason: 'вторая подгрузка не была отсечена');
    });

    test('ГРАНИЦА: схлопнутая пагинация гасит подгрузку молча', () async {
      // Продолжение находки сессии 1. Бэкенд переименовал `totalPages` —
      // сервис подставил единицу. Здесь видно следствие на экране: список
      // честно говорит «45 найдено», показывает двадцать и больше ничего
      // не подгружает. Ни ошибки, ни пустоты — жаловаться не на что.
      final p = providerWith(
        envelope: (page) {
          final env = searchEnvelope(page: page, total: 45, totalPages: 3);
          final data = env['data'] as Map<String, dynamic>;
          data['pagination'] = renamed(
              data['pagination'] as Map<String, dynamic>,
              'totalPages',
              'total_pages');
          return env;
        },
      );

      await p.searchEstablishments();

      expect(p.totalResults, 45);
      expect(p.hasMorePages, isFalse,
          reason: 'подгрузка выключена подстановкой, а не концом выдачи');
    });

    test('пустая страница при живом счётчике возвращает на последнюю', () async {
      // Гость ушёл с третьей страницы, выдача сократилась, вернулся: сервер
      // честно отдаёт пустой список при total > 0. Без возврата экран
      // показал бы «ничего не найдено» при сорока пяти найденных, и уйти
      // оттуда было бы нечем — `hasMorePages` ложно, кнопки «назад» нет.
      final p = providerWith(
        envelope: (page) => searchEnvelope(
          establishments:
              page >= 3 ? const [] : [establishmentRow(name: 'Стр $page')],
          page: page,
          total: 45,
          totalPages: 2,
        ),
      );

      await p.searchEstablishments(page: 3);

      expect(p.currentPage, 2, reason: 'вернулись на последнюю существующую');
      expect(p.establishments, isNotEmpty);
    });

    test('возврат делается ровно один раз, без бесконечного круга', () async {
      // Если и пересчитанная страница пуста (счётчик устарел вместе с
      // выдачей), повтор обязан остановиться, а не ходить по кругу.
      var requests = 0;
      installWireStand((options) {
        requests++;
        return jsonBody(searchEnvelope(
          establishments: const [],
          page: int.tryParse('${options.queryParameters['page']}') ?? 1,
          total: 45,
          totalPages: 2,
        ));
      });
      final p = EstablishmentsProvider();
      addTearDown(p.dispose);

      await p.searchEstablishments(page: 3);

      expect(requests, 2, reason: 'исходный запрос и ровно один возврат');
      expect(p.establishments, isEmpty);
    });

    test('честно пустая выдача возврата не вызывает', () async {
      // Ноль найденных — это не «страница устарела», а «ничего не нашлось».
      // Повтор здесь был бы лишним запросом на каждый пустой поиск.
      var requests = 0;
      installWireStand((_) {
        requests++;
        return jsonBody(searchEnvelope(
            establishments: const [], page: 2, total: 0, totalPages: 0));
      });
      final p = EstablishmentsProvider();
      addTearDown(p.dispose);

      await p.searchEstablishments(page: 2);

      expect(requests, 1);
      expect(p.establishments, isEmpty);
      expect(p.totalResults, 0);
    });

    test('пустая первая страница возврата не вызывает', () async {
      // Возвращаться некуда: первая страница и есть последняя существующая.
      var requests = 0;
      installWireStand((_) {
        requests++;
        return jsonBody(searchEnvelope(
            establishments: const [], page: 1, total: 45, totalPages: 3));
      });
      final p = EstablishmentsProvider();
      addTearDown(p.dispose);

      await p.searchEstablishments();

      expect(requests, 1);
    });
  });

  group('Ошибка не оставляет ложно свежих данных', () {
    test('неудачное обновление не выдаёт прежний список за новый', () async {
      // Грань 3: провайдер, сохраняющий прежние данные при ошибке, гасит
      // полосу загрузки, и устаревшие числа выглядят окончательными.
      var fail = false;
      installWireStand((_) => fail
          ? jsonBody(<String, dynamic>{'error': 'boom'}, status: 403)
          : jsonBody(searchEnvelope(
              establishments: [establishmentRow(name: 'Живое')])));
      final p = EstablishmentsProvider();
      addTearDown(p.dispose);

      await p.searchEstablishments();
      expect(p.establishments, hasLength(1));

      fail = true;
      await p.refresh();

      expect(p.isLoading, isFalse);
      expect(p.error, isNotNull);
      expect(p.establishments, isEmpty,
          reason: 'список не должен выглядеть свежим после отказа');
    });

    test('неудачная подгрузка сохраняет уже показанные страницы', () async {
      // Обратное направление: здесь потерять показанное как раз нельзя —
      // гость смотрел на эти карточки, и они не устарели от того, что
      // следующая страница не пришла.
      var fail = false;
      installWireStand((options) {
        if (fail) return jsonBody(<String, dynamic>{'error': 'boom'}, status: 403);
        return jsonBody(searchEnvelope(
          establishments: [establishmentRow(id: 'a', name: 'Первое')],
          page: 1,
          total: 45,
          totalPages: 3,
        ));
      });
      final p = EstablishmentsProvider();
      addTearDown(p.dispose);

      await p.searchEstablishments();
      fail = true;
      await p.loadMore();

      expect(p.establishments.map((e) => e.name), ['Первое']);
      expect(p.isLoadingMore, isFalse);
      expect(p.error, isNotNull);
    });

    test('ошибка снимается явно и не переживает следующий успех', () async {
      var fail = true;
      installWireStand((_) => fail
          ? jsonBody(<String, dynamic>{'error': 'boom'}, status: 403)
          : jsonBody(searchEnvelope()));
      final p = EstablishmentsProvider();
      addTearDown(p.dispose);

      await p.searchEstablishments();
      expect(p.error, isNotNull);

      fail = false;
      await p.refresh();

      expect(p.error, isNull,
          reason: 'сообщение об ошибке пережило удачную выдачу');
    });
  });

  group('Фильтры экрана', () {
    test('счётчик считает виды фильтров, а не выбранные значения', () async {
      final p = providerWith(envelope: (_) => searchEnvelope());

      expect(p.activeFilterCount, 0);

      p.toggleCategoryFilter('Бар');
      p.toggleCategoryFilter('Паб');
      expect(p.activeFilterCount, 1, reason: 'две категории — один вид');

      p.togglePriceFilter(PriceRange.budget);
      expect(p.activeFilterCount, 2);
    });

    test('ГРАНИЦА: город и строка поиска в счётчик не входят', () async {
      // Асимметрия намеренная и легко читается как дефект: `hasActiveFilters`
      // их учитывает, бейдж — нет. Город выбирается отдельным контролом, а
      // не в шторке фильтров, поэтому в бейдж не идёт. Зафиксировано, чтобы
      // расхождение не «починили» вслепую в одну из сторон.
      final p = providerWith(envelope: (_) => searchEnvelope());

      // Каждый признак проверяется В ОДИНОЧКУ. Вместе они держат
      // утверждение вдвоём, и снятие любого из них проходит незамеченным:
      // мутация «убрать город из hasActiveFilters» пережила проверку, где
      // рядом стояла строка поиска.
      p.setCity('Минск');
      expect(p.hasActiveFilters, isTrue, reason: 'один только город');
      expect(p.activeFilterCount, 0);

      p.clearFilters();
      p.setSearchQuery('драники');
      expect(p.hasActiveFilters, isTrue, reason: 'одна только строка поиска');
      expect(p.activeFilterCount, 0);
    });

    test('сброс обнуляет ровно то, что считает бейдж', () async {
      final p = providerWith(envelope: (_) => searchEnvelope());

      p.setCity('Минск');
      p.setSearchQuery('драники');
      p.toggleCategoryFilter('Бар');
      p.toggleCuisineFilter('Японская');
      p.togglePriceFilter(PriceRange.budget);
      p.toggleAmenityFilter('wifi');
      p.setHoursFilter(HoursFilter.until22);
      p.setDistanceFilter(DistanceOption.km1);
      expect(p.activeFilterCount, 6);

      p.clearFilters();

      expect(p.activeFilterCount, 0);
      expect(p.hasActiveFilters, isFalse);
      expect(p.selectedCity, isNull);
      expect(p.searchQuery, isNull);
      expect(p.categoryFilters, isEmpty);
      expect(p.cuisineFilters, isEmpty);
      expect(p.priceFilters, isEmpty);
      expect(p.amenityFilters, isEmpty);
      expect(p.hoursFilter, isNull);
      expect(p.distanceFilter, DistanceOption.all);
    });

    test('«выбрать все» и «снять все» по категориям', () async {
      final p = providerWith(envelope: (_) => searchEnvelope());

      p.setAllCategories(true);
      expect(p.allCategoriesSelected, isTrue);
      expect(p.categoryFilters, hasLength(FilterConstants.categories.length));

      p.toggleCategoryFilter(FilterConstants.categories.first);
      expect(p.allCategoriesSelected, isFalse,
          reason: 'снятая галочка обязана снимать признак «все»');

      p.setAllCategories(false);
      expect(p.categoryFilters, isEmpty);
    });

    test('фильтры экрана собираются в один набор для обоих движков',
        () async {
      final p = providerWith(envelope: (_) => searchEnvelope());

      p.setCity('Минск');
      p.toggleCategoryFilter('Бар');
      p.toggleCuisineFilter('Японская');
      p.togglePriceFilter(PriceRange.budget);
      p.toggleAmenityFilter('wifi');
      p.setHoursFilter(HoursFilter.until22);

      final f = p.screenFilters;
      expect(f.city, 'Минск');
      expect(f.categories, ['Бар']);
      expect(f.cuisines, ['Японская']);
      expect(f.priceRanges, isNotNull);
      expect(f.features, ['wifi']);
      expect(f.hoursFilter, isNotNull);
    });

    test('пустой вид фильтра не уходит пустым списком', () async {
      // Пустой список и отсутствие — разные вещи на проводе: `features=`
      // ушёл бы условием и обнулил выдачу.
      final p = providerWith(envelope: (_) => searchEnvelope());

      final f = p.screenFilters;
      expect(f.categories, isNull);
      expect(f.cuisines, isNull);
      expect(f.priceRanges, isNull);
      expect(f.features, isNull);
    });
  });

  group('Сортировка', () {
    test('без GPS «по расстоянию» откатывается на «по рейтингу»', () async {
      // Сортировать по расстоянию, которого нет, — молчаливая неправда:
      // список выйдет в произвольном порядке под подписью «по расстоянию».
      final p = providerWith(envelope: (_) => searchEnvelope());

      p.setSort(SortOption.distance);
      // `setSort` намеренно запускает поиск, не дожидаясь его: список должен
      // перестроиться сам. Хвост надо дождаться здесь, иначе он доедет до
      // перехватчика уже после конца теста и уронит СЛЕДУЮЩИЙ.
      await pumpEventQueue();
      expect(p.hasRealLocation, isFalse);
      expect(p.screenFilters.sortBy, SortOption.rating.toApiValue());

      p.setUserLocation(53.9, 27.5);
      expect(p.screenFilters.sortBy, SortOption.distance.toApiValue());
    });

    test('умному поиску уходит только сортировка, выбранная человеком',
        () async {
      final p = providerWith(envelope: (_) => searchEnvelope());

      expect(p.screenFilters.explicitSortBy, isNull,
          reason: 'умолчание не выбирал никто');

      p.setSort(SortOption.rating);
      await pumpEventQueue();
      expect(p.screenFilters.explicitSortBy, SortOption.rating.toApiValue());
    });

    test('повторный тап по уже выбранной сортировке — тоже выбор', () async {
      // Умолчание совпадает с «по рейтингу», поэтому первый тап по нему не
      // меняет значения. Если считать выбором только смену значения, тап
      // потеряется, и фраза «подешевле» переупорядочит выдачу вопреки
      // тому, что человек только что нажал.
      final p = providerWith(envelope: (_) => searchEnvelope());

      expect(p.currentSort, SortOption.rating);
      p.setSort(SortOption.rating);
      await pumpEventQueue();

      expect(p.screenFilters.explicitSortBy, SortOption.rating.toApiValue());
    });
  });

  group('Город', () {
    test('выбранный город доезжает до фильтров экрана', () async {
      final p = providerWith(envelope: (_) => searchEnvelope());

      p.setCity('Гродно');

      expect(p.selectedCity, 'Гродно');
      expect(p.screenFilters.city, 'Гродно');
    });

    test('сохранённый город поднимается при следующем запуске', () async {
      SharedPreferences.setMockInitialValues(<String, Object>{
        BelarusCities.persistenceKey: 'Брест',
      });
      final p = providerWith(envelope: (_) => searchEnvelope());

      final found = await p.loadPersistedCity();

      expect(found, isTrue);
      expect(p.selectedCity, 'Брест');
    });

    test('сохранённого города нет — выбор остаётся пустым', () async {
      final p = providerWith(envelope: (_) => searchEnvelope());

      final found = await p.loadPersistedCity();

      expect(found, isFalse);
      expect(p.selectedCity, isNull);
    });
  });

  group('Избранное', () {
    test('добавление видно сразу, до ответа сервера', () async {
      final p = providerWith(envelope: (_) => searchEnvelope());

      final pending = p.toggleFavorite('abc');

      expect(p.isFavorite('abc'), isTrue,
          reason: 'сердечко обязано загораться по нажатию, а не по ответу');
      await pending;
    });

    test('отказ сервера откатывает добавление', () async {
      installWireStand(
        (_) => jsonBody(<String, dynamic>{'error': 'boom'}, status: 403),
      );
      final p = EstablishmentsProvider();
      addTearDown(p.dispose);

      await p.toggleFavorite('abc');

      expect(p.isFavorite('abc'), isFalse,
          reason: 'сердечко осталось гореть у незаписанного избранного');
      expect(p.error, isNotNull);
    });

    test('отказ сервера откатывает и удаление — карточка возвращается',
        () async {
      // Переход A→B→A. Откат удаления сложнее отката добавления: вернуть
      // надо не только признак, но и саму карточку в список избранного.
      var fail = false;
      installWireStand((_) => fail
          ? jsonBody(<String, dynamic>{'error': 'boom'}, status: 403)
          : jsonBody(favoritesEnvelope(
              favorites: [favoriteRow(id: 'abc', name: 'Васильки')])));
      final p = EstablishmentsProvider();
      addTearDown(p.dispose);

      await p.loadFavorites();
      expect(p.favoriteEstablishments.map((e) => e.name), ['Васильки']);

      fail = true;
      await p.toggleFavorite('abc');

      expect(p.isFavorite('abc'), isTrue);
      expect(p.favoriteEstablishments.map((e) => e.name), ['Васильки'],
          reason: 'карточка не вернулась в список после отката');
    });

    test('загрузка избранного заполняет и признаки, и список', () async {
      installWireStand((_) => jsonBody(favoritesEnvelope(favorites: [
            favoriteRow(id: 'a', name: 'Первое'),
            favoriteRow(id: 'b', name: 'Второе'),
          ])));
      final p = EstablishmentsProvider();
      addTearDown(p.dispose);

      await p.loadFavorites();

      expect(p.favoriteIds, {'a', 'b'});
      expect(p.favoriteEstablishments, hasLength(2));
      expect(p.isFavoritesLoading, isFalse);
      expect(p.favoritesError, isNull);
    });

    test('отказ загрузки избранного не выдаёт пустой список за пустое '
        'избранное', () async {
      // «Ничего не сохранено» и «не удалось загрузить» — разные экраны.
      installWireStand(
        (_) => jsonBody(<String, dynamic>{'error': 'boom'}, status: 403),
      );
      final p = EstablishmentsProvider();
      addTearDown(p.dispose);

      await p.loadFavorites();

      expect(p.favoritesError, isNotNull);
      expect(p.isFavoritesLoading, isFalse);
    });
  });
}
