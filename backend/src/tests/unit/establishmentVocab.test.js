/**
 * Unit — establishment vocabulary canon (CAT-C-2.9).
 *
 * Guards the invariants that make Cyrillic-canon-at-rest coherent, with NO
 * database dependency:
 *   1. Golden membership — the canon is exactly 15 categories / 12 cuisines /
 *      10 attribute keys. Catches an accidental edit to the shared constant.
 *   2. Discoverability invariant — every canon category/cuisine has a URL slug
 *      (a null slug silently drops the row from sitemap + catalog browse).
 *   3. Migration parity — the canon arrays embedded in the DB CHECK
 *      (migration 030) equal the JS canon. The parser also inspects
 *      production_schema.sql: once 030 is folded in by a future regen, that
 *      artifact is checked too — this is the 029-style silent-drift guard
 *      (regen once dropped the Могилёв ё-variant unnoticed).
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  VALID_CATEGORIES,
  VALID_CUISINES,
  ATTRIBUTE_CANON,
  isValidCategory,
  isValidCuisine,
  isCanonAttributeKey,
} from '../../constants/establishmentVocab.js';
import { CATEGORY_SLUG_MAP, CUISINE_SLUG_MAP } from '../../constants/urlSlugs.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../../../migrations');

/**
 * Extract the quoted string literals from a `<column> <@ ARRAY[ … ]::varchar[]`
 * fragment in a SQL file. Returns the elements in file order, or null if the
 * fragment is absent (e.g. production_schema.sql before 030 is folded in).
 */
function extractCanonFromCheck(sql, column) {
  const re = new RegExp(`${column}\\s*<@\\s*ARRAY\\[([\\s\\S]*?)\\]::varchar\\[\\]`, 'i');
  const m = sql.match(re);
  if (!m) return null;
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

const GOLDEN_CATEGORIES = [
  'Ресторан', 'Кофейня', 'Кафе', 'Фаст-фуд', 'Бар', 'Кондитерская', 'Пиццерия',
  'Пекарня', 'Паб', 'Столовая', 'Кальянная', 'Боулинг', 'Караоке', 'Бильярд', 'Клуб',
];
const GOLDEN_CUISINES = [
  'Народная', 'Авторская', 'Азиатская', 'Американская', 'Вегетарианская', 'Японская',
  'Грузинская', 'Итальянская', 'Смешанная', 'Европейская', 'Китайская', 'Восточная',
];
const GOLDEN_ATTRIBUTES = [
  'delivery', 'wifi', 'terrace', 'parking', 'live_music', 'kids_zone', 'banquet',
  'pets_allowed', 'smoking', 'accessible_environment',
];

describe('establishmentVocab — golden membership', () => {
  test('categories are exactly the canonical 15', () => {
    expect(VALID_CATEGORIES).toEqual(GOLDEN_CATEGORIES);
    expect(VALID_CATEGORIES).toHaveLength(15);
    expect(new Set(VALID_CATEGORIES).size).toBe(15); // no duplicates
  });

  test('cuisines are exactly the canonical 12', () => {
    expect(VALID_CUISINES).toEqual(GOLDEN_CUISINES);
    expect(VALID_CUISINES).toHaveLength(12);
    expect(new Set(VALID_CUISINES).size).toBe(12);
  });

  test('attribute canon is exactly the canonical 10 (SDL CAT-C-3.15)', () => {
    expect(ATTRIBUTE_CANON).toEqual(GOLDEN_ATTRIBUTES);
    expect(ATTRIBUTE_CANON).toHaveLength(10);
    expect(new Set(ATTRIBUTE_CANON).size).toBe(10);
  });

  test('canon arrays are frozen (import consumers cannot mutate)', () => {
    expect(Object.isFrozen(VALID_CATEGORIES)).toBe(true);
    expect(Object.isFrozen(VALID_CUISINES)).toBe(true);
    expect(Object.isFrozen(ATTRIBUTE_CANON)).toBe(true);
  });

  test('membership helpers agree with the arrays', () => {
    expect(isValidCategory('Ресторан')).toBe(true);
    expect(isValidCategory('restaurant')).toBe(false);
    expect(isValidCuisine('Народная')).toBe(true);
    expect(isValidCuisine('belarusian')).toBe(false);
    expect(isCanonAttributeKey('wifi')).toBe(true);
    expect(isCanonAttributeKey('banquets')).toBe(false); // legacy mobile key, not canon
  });
});

describe('establishmentVocab — discoverability invariant (canon → non-null slug)', () => {
  test('every canonical category has a URL slug', () => {
    for (const category of VALID_CATEGORIES) {
      expect(CATEGORY_SLUG_MAP[category]).toBeTruthy();
    }
  });

  test('every canonical cuisine has a URL slug', () => {
    for (const cuisine of VALID_CUISINES) {
      expect(CUISINE_SLUG_MAP[cuisine]).toBeTruthy();
    }
  });

  test('slug maps carry no keys outside the canon (no orphan slugs)', () => {
    expect(Object.keys(CATEGORY_SLUG_MAP).sort()).toEqual([...VALID_CATEGORIES].sort());
    expect(Object.keys(CUISINE_SLUG_MAP).sort()).toEqual([...VALID_CUISINES].sort());
  });

  test('category slugs are unique (no two categories share a URL)', () => {
    const slugs = Object.values(CATEGORY_SLUG_MAP);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  test('cuisine slugs are unique', () => {
    const slugs = Object.values(CUISINE_SLUG_MAP);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe('establishmentVocab — DB CHECK parity (migration ↔ JS canon)', () => {
  const migration030 = readFileSync(
    join(MIGRATIONS_DIR, '030_category_cuisine_canon_check.sql'),
    'utf8',
  );

  test('030 categories CHECK matches JS canon (order-independent)', () => {
    const fromSql = extractCanonFromCheck(migration030, 'categories');
    expect(fromSql).not.toBeNull();
    expect([...fromSql].sort()).toEqual([...VALID_CATEGORIES].sort());
  });

  test('030 cuisines CHECK matches JS canon', () => {
    const fromSql = extractCanonFromCheck(migration030, 'cuisines');
    expect(fromSql).not.toBeNull();
    expect([...fromSql].sort()).toEqual([...VALID_CUISINES].sort());
  });

  test('production_schema.sql canon CHECK (if folded in) matches JS canon — regen-drift guard', () => {
    // Absent today (030 not yet applied to prod / not yet regenerated in). Once a
    // future regen folds it in, this asserts the regenerated artifact did not
    // silently drop a value — the CAT-C-2.9 analogue of the 029 Могилёв incident.
    const schema = readFileSync(join(MIGRATIONS_DIR, 'production_schema.sql'), 'utf8');
    const cats = extractCanonFromCheck(schema, 'categories');
    const cuis = extractCanonFromCheck(schema, 'cuisines');
    // Оба CHECK сворачиваются вместе или не сворачиваются вовсе: половинчатая
    // регенерация оставила бы один канон без ограничения. Это утверждение —
    // единственное, что тест доказывает, пока фрагментов нет; без него обе
    // ветки ниже ложны, и тест не выполняет НИ ОДНОЙ проверки.
    expect(cats === null).toBe(cuis === null);
    if (cats !== null) {
      expect([...cats].sort()).toEqual([...VALID_CATEGORIES].sort());
      expect([...cuis].sort()).toEqual([...VALID_CUISINES].sort());
    }
  });
});
