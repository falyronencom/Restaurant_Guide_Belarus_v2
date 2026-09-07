/**
 * catalog-params — shared search-param parsing for the results pages
 * (/[city] and /[city]/[category]). Pure functions; the SEO noindex predicate
 * (hasAnyFilter) lives here and gates both pages, so lock it directly.
 */
import {
  asFloat,
  asHours,
  asList,
  asString,
  hasAnyFilter,
  parsePage,
} from '@/lib/catalog-params';

describe('asList', () => {
  it('splits a comma-joined value, trims, drops empties', () => {
    expect(asList('italian, asian ,')).toEqual(['italian', 'asian']);
  });
  it('flattens array-form (?k=a&k=b)', () => {
    expect(asList(['a', 'b,c'])).toEqual(['a', 'b', 'c']);
  });
  it('returns [] for undefined / non-string', () => {
    expect(asList(undefined)).toEqual([]);
    expect(asList(5)).toEqual([]);
  });
});

describe('asHours', () => {
  it('passes a known bucket through', () => {
    expect(asHours('until_22')).toBe('until_22');
  });
  it('soft-ignores an unknown bucket', () => {
    expect(asHours('garbage')).toBeUndefined();
  });
});

describe('parsePage', () => {
  it('parses a positive page', () => {
    expect(parsePage('3')).toBe(3);
  });
  it('floors invalid / <1 / non-string to 1', () => {
    expect(parsePage('0')).toBe(1);
    expect(parsePage('x')).toBe(1);
    expect(parsePage(undefined)).toBe(1);
  });
});

describe('asString / asFloat', () => {
  it('asString: non-empty string, else undefined', () => {
    expect(asString('a')).toBe('a');
    expect(asString('')).toBeUndefined();
    expect(asString(5)).toBeUndefined();
  });
  it('asFloat: finite number, else undefined', () => {
    expect(asFloat('4.5')).toBe(4.5);
    expect(asFloat('')).toBeUndefined();
    expect(asFloat('x')).toBeUndefined();
  });
});

describe('hasAnyFilter — SEO noindex predicate (CAT-C-2.3)', () => {
  it('false for a clean URL', () => {
    expect(hasAnyFilter({})).toBe(false);
  });
  it('false for page-only — paginated URLs stay indexable', () => {
    expect(hasAnyFilter({ page: '2' })).toBe(false);
  });
  it('false for an unknown hours value (not a real filter)', () => {
    expect(hasAnyFilter({ hours: 'garbage' })).toBe(false);
  });
  it('true for each real facet/sort/search param', () => {
    expect(hasAnyFilter({ cuisine: 'italian' })).toBe(true);
    // Honesty audit 2026-09-07: the enumeration must stay complete — `features`
    // was missing, and deleting its clause from hasAnyFilter kept all 13 tests
    // green while filtered URLs went back into the index.
    expect(hasAnyFilter({ features: 'wifi' })).toBe(true);
    expect(hasAnyFilter({ priceRange: '$' })).toBe(true);
    expect(hasAnyFilter({ hours: 'until_22' })).toBe(true);
    expect(hasAnyFilter({ minRating: '4' })).toBe(true);
    expect(hasAnyFilter({ search: 'pizza' })).toBe(true);
    expect(hasAnyFilter({ sort_by: 'rating' })).toBe(true);
  });
});
