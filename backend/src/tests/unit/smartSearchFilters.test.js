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
