/**
 * extractActiveAttributes — the JSONB `attributes` → amenity-tile mapping.
 *
 * `components/establishment/Attributes.tsx` renders one tile per returned key
 * and nothing at all for an empty list, so this pure function alone decides
 * WHICH amenities a card claims to have. Two properties matter:
 *
 *   1. Only `true` counts. `{wifi: false}` in the JSONB must NOT draw Wi-Fi.
 *      Relaxing the check to `!== undefined` is exactly the defect closed in
 *      mobile on 2026-09-07 (629c233), where cards advertised three amenities
 *      the establishments did not have. Claiming a missing amenity is worse
 *      than showing none: the reader plans an evening around it.
 *   2. Output order is the canonical ATTRIBUTE_ORDER, not the key order of the
 *      raw JSONB — so tiles do not reshuffle between cards or renders.
 *
 * Honesty-audit boundary (2026-09-08): before this file NO assertion in the web
 * suite looked at the result — pilot mutation M51 (`obj[key] === true` →
 * `obj[key] !== undefined`) kept all 481 tests green. The order case compares
 * the WHOLE array with `toEqual`; a membership check cannot see a permutation.
 * The expected order is spelled out literally rather than derived from the
 * exported ATTRIBUTE_ORDER on purpose — an expectation computed from the
 * constant under test proves only that the constant equals itself.
 */
import { extractActiveAttributes } from '@/lib/establishment-helpers';

describe('extractActiveAttributes', () => {
  it('counts only `true` — an explicit `false` is dropped like a missing key', () => {
    expect(extractActiveAttributes({ wifi: true, terrace: false })).toEqual([
      'wifi',
    ]);
  });

  it('returns keys in the canonical order, not in the order of the raw JSONB', () => {
    // Insertion order deliberately reversed against the canon.
    const raw = { smoking: true, banquet: true, wifi: true, delivery: true };
    expect(extractActiveAttributes(raw)).toEqual([
      'delivery',
      'wifi',
      'banquet',
      'smoking',
    ]);
  });

  it('returns an empty list for null, undefined and non-objects', () => {
    expect(extractActiveAttributes(null)).toEqual([]);
    expect(extractActiveAttributes(undefined)).toEqual([]);
    expect(extractActiveAttributes('wifi')).toEqual([]);
    expect(extractActiveAttributes(42)).toEqual([]);
  });

  it('ignores a key outside the canon — the JSONB column is not a closed set', () => {
    expect(
      extractActiveAttributes({ wifi: true, tesla_charger: true }),
    ).toEqual(['wifi']);
  });
});
