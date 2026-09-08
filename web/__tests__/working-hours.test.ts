/**
 * working-hours — the schedule parser behind the "Открыто / Закрыто" badge.
 *
 * ~140 of this module's lines are a port of mobile's parseDayHours /
 * isCurrentlyOpen. It decides, for every card and every establishment page,
 * whether a place is called open right now — a verdict a reader acts on by
 * getting into a car. Nothing downstream re-derives it.
 *
 * Honesty-audit boundary (2026-09-08). Before this file the function was
 * EXECUTED transitively — favorites-list.test.tsx renders real
 * EstablishmentCard → OpenStatusBadge and enters the statusFallback branch —
 * but no assertion anywhere looked at its result, and the overnight-rollover
 * branch was executed by no test at all. Pilot mutation M45 broke that branch
 * ("open past midnight" → always closed) and left all 481 tests green. The
 * strings «Открыто»/«Закрыто» live only in open-status-badge.test.tsx, which
 * mocks this module.
 *
 * TIME FIXTURES — component-wise local constructor, never an ISO string with
 * `Z`. computeOpenStatus takes `now` as a parameter (no fake timers needed),
 * but reads it with LOCAL getters: getDay(), getHours(), getMinutes(). A
 * component-wise `new Date(2026, 8, 7, 14, 30)` cancels out against local
 * getters and yields the same verdict in any zone; `'2026-09-07T14:30:00Z'`
 * would pin the fixture to the runner's offset and drift between this machine
 * and the gate (feedback_timezone_axis_naive_timestamps).
 *
 * NOT covered here on purpose: normalizeCategory / normalizeCuisine and their
 * legacy maps at the bottom of the module. Pilot finding 14 — dead against
 * production data, removed only after migration 030 lands and in all three
 * copies at once. Separate decision, not this chip's.
 */
import { computeOpenStatus, parseDayHours } from '@/lib/working-hours';

// 2026-09-07 is a Monday (getDay() === 1), 2026-09-06 a Sunday (getDay() === 0).
// Month is 0-based: 8 = September.
const monday = (h: number, m: number) => new Date(2026, 8, 7, h, m);
const sunday = (h: number, m: number) => new Date(2026, 8, 6, h, m);

describe('parseDayHours', () => {
  it('parses the "HH:MM-HH:MM" string form and trims the halves', () => {
    expect(parseDayHours('10:00-22:00')).toEqual({
      open: '10:00',
      close: '22:00',
      isOpen: true,
    });
    expect(parseDayHours(' 10:00 - 22:00 ')).toEqual({
      open: '10:00',
      close: '22:00',
      isOpen: true,
    });
  });

  it('rejects a string that is not exactly two non-empty halves', () => {
    expect(parseDayHours('10:00')).toBeNull(); // one part
    expect(parseDayHours('10-22-00')).toBeNull(); // three parts
    expect(parseDayHours('-22:00')).toBeNull(); // empty open
    expect(parseDayHours('10:00-')).toBeNull(); // empty close
    expect(parseDayHours('10:00-   ')).toBeNull(); // whitespace-only close
  });

  it('reads { is_open: false } as the closed marker, even beside times', () => {
    expect(parseDayHours({ is_open: false })).toEqual({
      open: null,
      close: null,
      isOpen: false,
    });
    // The flag wins over strings that are still present in the JSONB.
    expect(
      parseDayHours({ is_open: false, open: '10:00', close: '22:00' }),
    ).toEqual({ open: null, close: null, isOpen: false });
  });

  it('normalizes the object form, with or without an explicit is_open', () => {
    const normalized = { open: '09:00', close: '18:00', isOpen: true };
    expect(parseDayHours({ open: '09:00', close: '18:00' })).toEqual(
      normalized,
    );
    expect(
      parseDayHours({ is_open: true, open: '09:00', close: '18:00' }),
    ).toEqual(normalized);
    // Non-string times inside an object are dropped, the day stays "open" —
    // that combination is what routes computeOpenStatus to statusFallback.
    expect(parseDayHours({ open: 900, close: null })).toEqual({
      open: null,
      close: null,
      isOpen: true,
    });
  });

  it('returns null for null, undefined and non string/object entries', () => {
    expect(parseDayHours(null)).toBeNull();
    expect(parseDayHours(undefined)).toBeNull();
    expect(parseDayHours(42)).toBeNull();
    expect(parseDayHours(true)).toBeNull();
  });
});

describe('computeOpenStatus', () => {
  it('keeps an overnight schedule open across midnight (18:00-02:00)', () => {
    // The M45 branch. Three points, not one: before midnight, after midnight,
    // and midday — a mutant that hard-codes "closed" survives any single
    // "open" point that happens to sit outside the window.
    const hours = { monday: '18:00-02:00' };

    expect(computeOpenStatus(hours, 'active', monday(23, 0))).toEqual({
      isOpen: true,
      closingTime: '02:00',
      source: 'workingHours',
    });
    expect(computeOpenStatus(hours, 'active', monday(1, 0))).toEqual({
      isOpen: true,
      closingTime: '02:00',
      source: 'workingHours',
    });
    expect(computeOpenStatus(hours, 'active', monday(12, 0))).toEqual({
      isOpen: false,
      closingTime: '02:00',
      source: 'workingHours',
    });
  });

  it('treats close equal to open as round-the-clock, not as a zero-width window', () => {
    // Pins `closeMin <= openMin` (wrap-around) against `closeMin < openMin`,
    // which would send 12:00-12:00 down the plain-day branch and report the
    // place closed at every minute of the day.
    const hours = { monday: '12:00-12:00' };

    expect(computeOpenStatus(hours, 'active', monday(11, 59))).toEqual({
      isOpen: true,
      closingTime: '12:00',
      source: 'workingHours',
    });
    expect(computeOpenStatus(hours, 'active', monday(12, 0))).toEqual({
      isOpen: true,
      closingTime: '12:00',
      source: 'workingHours',
    });
  });

  it('reports a plain day with its close time and the workingHours source', () => {
    const hours = { monday: { open: '10:00', close: '22:00' } };

    expect(computeOpenStatus(hours, 'active', monday(14, 30))).toEqual({
      isOpen: true,
      closingTime: '22:00',
      source: 'workingHours',
    });
    // Closed verdicts still carry the day's close time, and `status: 'active'`
    // does not overrule the schedule.
    expect(computeOpenStatus(hours, 'active', monday(9, 59))).toEqual({
      isOpen: false,
      closingTime: '22:00',
      source: 'workingHours',
    });
    expect(computeOpenStatus(hours, 'active', monday(22, 30))).toEqual({
      isOpen: false,
      closingTime: '22:00',
      source: 'workingHours',
    });
  });

  it('opens on the opening minute and closes on the closing minute', () => {
    // Two separate points: they pin `>=` on open and `<` on close. A midday
    // point sees neither.
    const hours = { monday: '10:00-22:00' };

    expect(computeOpenStatus(hours, 'active', monday(10, 0)).isOpen).toBe(true);
    expect(computeOpenStatus(hours, 'active', monday(9, 59)).isOpen).toBe(
      false,
    );
    expect(computeOpenStatus(hours, 'active', monday(21, 59)).isOpen).toBe(
      true,
    );
    expect(computeOpenStatus(hours, 'active', monday(22, 0)).isOpen).toBe(
      false,
    );
  });

  it('maps Sunday to the last DAY_KEYS slot, not to the first', () => {
    // DAY_KEYS runs Mon..Sun while getDay() runs Sun=0..Sat=6, so Sunday needs
    // index 6 and every other day shifts down by one. A map open ONLY on
    // Sunday: the Sunday point catches an unshifted index (it would read
    // Monday), the Monday point catches a Monday lookup landing on Sunday.
    // `status: 'inactive'` throughout, so the open verdict can only come from
    // the schedule.
    const sundayOnly = { sunday: '10:00-22:00' };

    expect(computeOpenStatus(sundayOnly, 'inactive', sunday(14, 0))).toEqual({
      isOpen: true,
      closingTime: '22:00',
      source: 'workingHours',
    });
    expect(computeOpenStatus(sundayOnly, 'inactive', monday(14, 0))).toEqual({
      isOpen: false,
      closingTime: null,
      source: 'statusFallback',
    });
  });

  it('falls back to status when the day is absent, incomplete or unparsable', () => {
    const fallbackOpen = {
      isOpen: true,
      closingTime: null,
      source: 'statusFallback',
    };

    // (a) nothing usable to look a day up in
    expect(computeOpenStatus(null, 'active', monday(14, 0))).toEqual(
      fallbackOpen,
    );
    expect(computeOpenStatus('10:00-22:00', 'active', monday(14, 0))).toEqual(
      fallbackOpen,
    );
    expect(
      computeOpenStatus({ tuesday: '10:00-22:00' }, 'active', monday(14, 0)),
    ).toEqual(fallbackOpen);

    // (b) the day is marked open but carries no times
    expect(
      computeOpenStatus({ monday: { is_open: true } }, 'active', monday(14, 0)),
    ).toEqual(fallbackOpen);

    // (c) times are there but do not parse into minutes
    expect(
      computeOpenStatus(
        { monday: { open: 'ab:cd', close: 'ef:gh' } },
        'active',
        monday(14, 0),
      ),
    ).toEqual(fallbackOpen);

    // The fallback follows `status`, and closingTime is dropped even when a
    // close string was known — the badge must not pair a status verdict with
    // a schedule time.
    expect(
      computeOpenStatus(
        { monday: { is_open: true, close: '22:00' } },
        'pending',
        monday(14, 0),
      ),
    ).toEqual({ isOpen: false, closingTime: null, source: 'statusFallback' });
  });

  it('treats is_open: false as a schedule verdict, not as a missing day', () => {
    // `status: 'active'` would say "open" if this fell through to the
    // fallback; the day off has to win, and be attributed to workingHours.
    expect(
      computeOpenStatus(
        { monday: { is_open: false } },
        'active',
        monday(14, 0),
      ),
    ).toEqual({ isOpen: false, closingTime: null, source: 'workingHours' });
  });
});
