/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: smartSearchService.buildSmartSearchFilters
 *
 * Segment B introduces `dish` and routes `price_max` based on its presence:
 *   - With dish:    price_max → priceMaxByn (literal BYN on menu_items.price_byn)
 *   - Without dish: price_max → priceRange (legacy subjective tier mapping)
 */

import { buildSmartSearchFilters } from '../../services/smartSearchService.js';

describe('buildSmartSearchFilters — dish routing', () => {
  test('sets filters.dish when intent.dish is non-empty', () => {
    const intent = {
      dish: 'кофе',
      category: null,
      cuisine: null,
      price_max: null,
      meal_type: null,
      location: null,
      sort: null,
      tags: [],
      error: null,
    };

    const filters = buildSmartSearchFilters(intent);

    expect(filters.dish).toBe('кофе');
    expect(filters.priceRange).toBeUndefined();
    expect(filters.priceMaxByn).toBeUndefined();
  });

  test('does NOT set filters.dish when intent.dish is null', () => {
    const intent = {
      dish: null,
      category: 'Кофейня',
      cuisine: null,
      price_max: null,
      meal_type: null,
      location: null,
      sort: null,
      tags: [],
      error: null,
    };

    const filters = buildSmartSearchFilters(intent);

    expect(filters.dish).toBeUndefined();
    expect(filters.categories).toEqual(['Кофейня']);
  });
});

describe('buildSmartSearchFilters — price routing with/without dish', () => {
  test('price_max routes to priceMaxByn when dish is set', () => {
    const intent = {
      dish: 'бургер',
      category: null,
      cuisine: null,
      price_max: 10,
      meal_type: null,
      location: null,
      sort: null,
      tags: [],
      error: null,
    };

    const filters = buildSmartSearchFilters(intent);

    expect(filters.priceMaxByn).toBe(10);
    expect(filters.priceRange).toBeUndefined();
  });

  test('price_max routes to priceRange when dish is NOT set (legacy)', () => {
    const intent = {
      dish: null,
      category: 'Кофейня',
      cuisine: null,
      price_max: 12,
      meal_type: null,
      location: null,
      sort: null,
      tags: [],
      error: null,
    };

    const filters = buildSmartSearchFilters(intent);

    expect(filters.priceMaxByn).toBeUndefined();
    expect(filters.priceRange).toEqual(['$']);
  });

  test('price_max=25 maps to ["$", "$$"] without dish', () => {
    const intent = {
      dish: null,
      category: null,
      cuisine: null,
      price_max: 25,
      meal_type: null,
      location: null,
      sort: null,
      tags: [],
      error: null,
    };

    expect(buildSmartSearchFilters(intent).priceRange).toEqual(['$', '$$']);
  });

  test('price_max=100 maps to ["$", "$$", "$$$"] without dish', () => {
    const intent = {
      dish: null,
      category: null,
      cuisine: null,
      price_max: 100,
      meal_type: null,
      location: null,
      sort: null,
      tags: [],
      error: null,
    };

    expect(buildSmartSearchFilters(intent).priceRange).toEqual(['$', '$$', '$$$']);
  });

  test('dish + price_max together: both filters set correctly', () => {
    const intent = {
      dish: 'кофе',
      category: null,
      cuisine: null,
      price_max: 5,
      meal_type: null,
      location: null,
      sort: null,
      tags: [],
      error: null,
    };

    const filters = buildSmartSearchFilters(intent);

    expect(filters.dish).toBe('кофе');
    expect(filters.priceMaxByn).toBe(5);
    expect(filters.priceRange).toBeUndefined();
  });
});

describe('buildSmartSearchFilters — tags alongside dish (prod defect 07.09.2026)', () => {
  // The parser restates the dish word in tags ("пицца" → dish="пицца",
  // tags=["пицца"]). Until the fix, tags became `filters.search` — an
  // establishment-level ILIKE AND-ed with the menu_items EXISTS — so any dish
  // outside SEARCH_SYNONYMS ("капучино") returned zero rows.
  const base = {
    category: null,
    cuisine: null,
    price_max: null,
    meal_type: null,
    location: null,
    sort: null,
    error: null,
  };

  test('with dish, tags are NOT applied as establishment-level search (no AND filter)', () => {
    const filters = buildSmartSearchFilters({ ...base, dish: 'капучино', tags: ['капучино'] });

    expect(filters.dish).toBe('капучино');
    expect(filters.search).toBeUndefined();
  });

  test('with dish and no budget, the dish term rides as an OR-alternative (dishOrSearch)', () => {
    const filters = buildSmartSearchFilters({ ...base, dish: 'пицца', tags: ['пицца'] });

    expect(filters.dish).toBe('пицца');
    expect(filters.dishOrSearch).toBe('пицца');
    expect(filters.search).toBeUndefined();
  });

  test('with dish and price_max, no OR-alternative: a stated budget needs a menu-verified match', () => {
    const filters = buildSmartSearchFilters({ ...base, dish: 'пицца', tags: ['пицца'], price_max: 20 });

    expect(filters.dish).toBe('пицца');
    expect(filters.priceMaxByn).toBe(20);
    expect(filters.dishOrSearch).toBeUndefined();
    expect(filters.search).toBeUndefined();
  });

  test('without dish, tags still become the legacy search text (unchanged path)', () => {
    const filters = buildSmartSearchFilters({ ...base, dish: null, tags: ['терраса', 'wifi'] });

    expect(filters.search).toBe('терраса wifi');
    expect(filters.dish).toBeUndefined();
    expect(filters.dishOrSearch).toBeUndefined();
  });
});
// ─── Явные фильтры экрана против догадок разбора ─────────────────────────────
//
// Решение 07.09.2026: строка поиска на mobile всегда ходит в умный эндпоинт,
// значит фильтры экрана (цена, часы, удобства, сортировка) должны работать и
// там. Спор возникает там, где разбор фразы подставил значение в ТОЙ ЖЕ
// размерности: «недорого» → ярус цены против снятой пользователем карточки
// «$$». Правило — контрол сильнее догадки; разные размерности складываются.

function intentOf(extra = {}) {
  return {
    dish: null, category: null, cuisine: null, price_max: null,
    meal_type: null, location: null, sort: null, tags: [], error: null, ...extra,
  };
}

describe('buildSmartSearchFilters — явное сильнее выведенного', () => {
  test('явный ярус цены заменяет ярусную подстановку из price_max', () => {
    // «до 10 рублей» без блюда подставляет ['$']; пользователь при этом
    // держит включённой карточку '$$$'. Побеждает карточка.
    const filters = buildSmartSearchFilters(
      intentOf({ price_max: 10 }),
      {},
      { priceRange: ['$$$'] },
    );

    expect(filters.priceRange).toEqual(['$$$']);
  });

  test('без явного яруса ярусная подстановка работает как раньше', () => {
    // Сохранённое поведение: если этот тест позеленеет при вырезанной
    // подстановке, он ничего не сторожит.
    const filters = buildSmartSearchFilters(intentOf({ price_max: 10 }), {});

    expect(filters.priceRange).toEqual(['$']);
  });

  test('бюджет блюда и явный ярус цены сосуществуют — размерности разные', () => {
    // priceMaxByn — цена позиции меню, priceRange — ценовой класс заведения.
    // «пицца за 20 рублей» с карточкой '$$' = позиция дешевле 20 BYN в
    // заведении класса '$$', а не выбор одного из двух.
    const filters = buildSmartSearchFilters(
      intentOf({ dish: 'пицца', price_max: 20 }),
      {},
      { priceRange: ['$$'] },
    );

    expect(filters.priceMaxByn).toBe(20);
    expect(filters.priceRange).toEqual(['$$']);
  });

  test('без явного яруса бюджет блюда по-прежнему НЕ подставляет ярус', () => {
    const filters = buildSmartSearchFilters(intentOf({ dish: 'пицца', price_max: 20 }), {});

    expect(filters.priceMaxByn).toBe(20);
    expect(filters.priceRange).toBeUndefined();
  });

  test('явная сортировка сильнее intent.sort', () => {
    const filters = buildSmartSearchFilters(
      intentOf({ sort: 'rating' }),
      {},
      { sortBy: 'price_asc' },
    );

    expect(filters.sortBy).toBe('price_asc');
  });

  test('явная сортировка сильнее умолчания по координатам', () => {
    const filters = buildSmartSearchFilters(
      intentOf(),
      { latitude: 53.9, longitude: 27.5 },
      { sortBy: 'rating' },
    );

    expect(filters.sortBy).toBe('rating');
  });

  test('без явной сортировки умолчание по координатам прежнее', () => {
    expect(buildSmartSearchFilters(intentOf(), { latitude: 53.9, longitude: 27.5 }).sortBy)
      .toBe('distance');
    expect(buildSmartSearchFilters(intentOf(), {}).sortBy).toBe('rating');
  });

  test('явные категории и кухни заменяют выведенные из фразы', () => {
    const filters = buildSmartSearchFilters(
      intentOf({ category: 'Кофейня', cuisine: ['Итальянская'] }),
      {},
      { categories: ['Бар'], cuisines: ['Японская'] },
    );

    expect(filters.categories).toEqual(['Бар']);
    expect(filters.cuisines).toEqual(['Японская']);
  });

  test('размерности, которых разбор не касается, пробрасываются как есть', () => {
    const filters = buildSmartSearchFilters(intentOf(), {}, {
      hoursFilter: 'until_22',
      features: ['wifi', 'terrace'],
      minRating: 4,
      maxDistance: 3,
      radius: 5,
    });

    expect(filters.hoursFilter).toBe('until_22');
    expect(filters.features).toEqual(['wifi', 'terrace']);
    expect(filters.minRating).toBe(4);
    expect(filters.maxDistance).toBe(3);
    expect(filters.radius).toBe(5);
  });

  test('город из фразы по-прежнему сильнее города контекста', () => {
    // Намеренно не тронуто: город, названный вслух, тоже явный.
    const filters = buildSmartSearchFilters(
      intentOf({ location: 'Гомель' }),
      { city: 'Минск' },
      { categories: ['Бар'] },
    );

    expect(filters.city).toBe('Гомель');
  });

  test('пустые явные фильтры не добавляют ключей вовсе', () => {
    // Ключ со значением null затёр бы умолчание searchService; ключ с пустым
    // массивом обнулил бы выдачу в SQL.
    const withEmpty = buildSmartSearchFilters(intentOf({ category: 'Кофейня' }), {}, {});
    const withNothing = buildSmartSearchFilters(intentOf({ category: 'Кофейня' }), {});

    expect(withEmpty).toEqual(withNothing);
    expect(withEmpty.categories).toEqual(['Кофейня']);
    expect('hoursFilter' in withEmpty).toBe(false);
    expect('features' in withEmpty).toBe(false);
  });
});
