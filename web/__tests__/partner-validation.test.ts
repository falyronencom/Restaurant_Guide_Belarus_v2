/**
 * Partner wizard gate logic (Phase C Slice 1, Segment B) — pure functions.
 *   meetsValidatorMinimum: the two-stage draft threshold (server-draft creation).
 *   evaluateE1: the sticky-sidebar checklist gating Submit.
 *   clientCompleteness: the base_score mirror driving the completeness bar.
 */
import { clientCompleteness } from '@/lib/partner/completeness';
import { emptyForm, type WizardFormState } from '@/lib/partner/form';
import { evaluateE1, meetsValidatorMinimum } from '@/lib/partner/validation';

function photo(i: number) {
  return { url: `https://cdn.example/p${i}.jpg` };
}

function withMondayOpen(f: WizardFormState): WizardFormState {
  return {
    ...f,
    workingHours: {
      ...f.workingHours,
      monday: { isOpen: true, open: '10:00', close: '22:00' },
    },
  };
}

describe('meetsValidatorMinimum', () => {
  /*
   * Honesty-audit boundary (2026-09-07): only ONE conjunct is ever falsified on
   * its own here — observed hours. `hasCuisine` (mutation M59), `hasCategory`,
   * `hasName`, `hasCity` and the `street || building` address rule (M34) are
   * never the sole reason a fixture is false, so each can be dropped from
   * validation.ts with this file green. Same shape in evaluateE1 below: only
   * `photos` and `menu` are individually falsified — `hours` and
   * `classification` are not (M62) — and the photo threshold is probed with 2
   * against 5, so 4 would pass as well (M60).
   */
  it('is false for an empty form', () => {
    expect(meetsValidatorMinimum(emptyForm())).toBe(false);
  });

  it('is true with name + city + address + ≥1 cat + ≥1 cuisine + observed hours (lat/lng NOT required)', () => {
    const f = withMondayOpen({
      ...emptyForm(),
      name: 'Кафе «Весна»',
      city: 'Минск',
      street: 'проспект Независимости',
      building: '10',
      categories: ['Кафе'],
      cuisines: ['Народная'],
    });
    expect(f.latitude).toBeNull();
    expect(meetsValidatorMinimum(f)).toBe(true);
  });

  it('is false without observed hours (no silent defaults — Q10)', () => {
    const f = {
      ...emptyForm(),
      name: 'Кафе',
      city: 'Минск',
      street: 'ул. 1',
      categories: ['Кафе'],
      cuisines: ['Народная'],
    };
    expect(meetsValidatorMinimum(f)).toBe(false);
  });
});

describe('evaluateE1', () => {
  const ready = withMondayOpen({
    ...emptyForm(),
    categories: ['Кафе'],
    cuisines: ['Народная'],
    description: 'о'.repeat(120),
    interiorPhotos: [photo(1), photo(2), photo(3), photo(4), photo(5)],
    menuPhotos: [photo(6)],
  });

  it('passes when the gating checks hold (description reported alongside)', () => {
    expect(evaluateE1(ready)).toMatchObject({
      photos: true,
      menu: true,
      classification: true,
      description: true,
      hours: true,
      passed: true,
    });
  });

  it('fails photos (and overall) with fewer than 5 interior photos', () => {
    const f = { ...ready, interiorPhotos: [photo(1), photo(2)] };
    const e1 = evaluateE1(f);
    expect(e1.photos).toBe(false);
    expect(e1.passed).toBe(false);
  });

  it('menu is satisfied by a PDF alone', () => {
    const f = {
      ...ready,
      menuPhotos: [],
      menuPdfs: [
        { url: 'm.pdf', thumbnail_url: '', preview_url: '', file_name: 'm.pdf' },
      ],
    };
    expect(evaluateE1(f).menu).toBe(true);
  });

  it('reports a short description as unmet but still passes (CAT-E-2.3 Amendment)', () => {
    const e1 = evaluateE1({ ...ready, description: 'коротко' });
    expect(e1.description).toBe(false);
    expect(e1.passed).toBe(true);
  });

  it('passes with NO description — it is a pre-flip requirement, not a submit gate', () => {
    const e1 = evaluateE1({ ...ready, description: '' });
    expect(e1.description).toBe(false);
    expect(e1.passed).toBe(true);
  });

  it('still fails when a genuinely gating item is missing', () => {
    expect(evaluateE1({ ...ready, description: '', menuPhotos: [] }).passed).toBe(
      false,
    );
  });
});

describe('clientCompleteness mirrors the base_score weights', () => {
  it('is 0 for an empty form', () => {
    expect(clientCompleteness(emptyForm())).toBe(0);
  });

  it('is 100 with all weighted fields present (25+25+20+15+10+5)', () => {
    const f: WizardFormState = {
      ...emptyForm(),
      description: 'Уютное место',
      priceRange: '$$',
      attributes: ['wifi'],
      phone: '+375291234567',
      email: 'info@example.by',
      website: 'example.by',
    };
    expect(clientCompleteness(f)).toBe(100);
  });

  it('sums only the present fields (description + phone = 40)', () => {
    const f = { ...emptyForm(), description: 'x', phone: '+375291112233' };
    expect(clientCompleteness(f)).toBe(40);
    // Honesty audit 2026-09-07: the total alone cannot see a permutation of the
    // weights — swapping priceRange (25) with attributes (20) left every test
    // green. Each weight this file claims to mirror is now pinned on its own.
    expect(clientCompleteness({ ...emptyForm(), priceRange: '$$' })).toBe(25);
    expect(clientCompleteness({ ...emptyForm(), attributes: ['wifi'] })).toBe(20);
    expect(clientCompleteness({ ...emptyForm(), email: 'info@example.by' })).toBe(10);
    expect(clientCompleteness({ ...emptyForm(), website: 'example.by' })).toBe(5);
  });
});
