/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Fixture contract: naive timestamps hold UTC wall clock
 * Контракт фикстур: наивные метки хранят UTC-стенку
 *
 * Every time column in the schema is `timestamp without time zone`. Production
 * writes `NOW()` / `CURRENT_TIMESTAMP` and the database runs in UTC, so a naive
 * value IS the UTC wall clock — `analyticsService.startOfUtcDay` builds every
 * window and bucket on that assumption.
 *
 * A test helper that binds a JS `Date` breaks the contract silently: node-pg
 * serialises a Date as LOCAL time with an offset (`2026-09-07T00:57:00+03:00`),
 * Postgres drops the offset when casting to a naive timestamp, and the row keeps
 * the process wall clock. Between 00:00 and 03:00 Minsk such a row carries
 * tomorrow's UTC date, lands in a bucket beyond the timeline axis, and the gate
 * reports `Expected: 13, Received: 0` (admin-analytics, run 34062250741).
 *
 * These tests read each stored value back as an instant — `AT TIME ZONE 'UTC'`
 * turns a naive-UTC value into timestamptz, which node-pg parses correctly in
 * any process timezone — and compare it with the JS clock. Under TZ=UTC they
 * are vacuous (both conventions coincide); the gate runs under Europe/Minsk,
 * where the pre-fix helpers drift by 10 800 s. Proven red on the old helpers
 * under Europe/Minsk and GMT+15:59, green after `utcTimestamp`.
 */

import { randomUUID } from 'crypto';
import { clearAllData, query } from '../utils/database.js';
import {
  createTestUser,
  storeRefreshToken,
  createTestEstablishment,
} from '../utils/auth.js';

// Host and pg-test share one clock; a minute absorbs any container skew while
// still failing on the smallest real offset from UTC (Europe/Minsk = 3 h).
const TOLERANCE_MS = 60 * 1000;

/**
 * Stored naive value read back as an epoch-ms instant, independent of the
 * process timezone. Table/column names are test-owned constants, not input.
 */
const storedInstant = async (table, column, keyColumn, keyValue) => {
  const { rows } = await query(
    `SELECT ${column} AT TIME ZONE 'UTC' AS at FROM ${table} WHERE ${keyColumn} = $1`,
    [keyValue]
  );
  expect(rows).toHaveLength(1);
  return new Date(rows[0].at).getTime();
};

const expectBetween = (value, before, after) => {
  expect(value).toBeGreaterThanOrEqual(before - TOLERANCE_MS);
  expect(value).toBeLessThanOrEqual(after + TOLERANCE_MS);
};

const freshUser = () => createTestUser({
  email: `utc-contract-${randomUUID()}@test.com`,
  phone: null,
  password: 'User123!@#',
  name: 'UTC Contract',
  role: 'user',
});

beforeAll(async () => {
  await clearAllData();
});

afterAll(async () => {
  await clearAllData();
});

describe('Test fixtures write naive timestamps as UTC wall clock', () => {
  test('createTestUser: created_at and updated_at are the current UTC instant', async () => {
    const before = Date.now();
    const user = await freshUser();
    const after = Date.now();

    for (const column of ['created_at', 'updated_at']) {
      expectBetween(await storedInstant('users', column, 'id', user.id), before, after);
    }
  });

  test('storeRefreshToken: created_at is now, expires_at is 30 days ahead — as UTC instants', async () => {
    const user = await freshUser();

    // Same arithmetic as the helper, taken a few ms earlier in the same zone.
    const expectedExpiry = new Date();
    expectedExpiry.setDate(expectedExpiry.getDate() + 30);

    const before = Date.now();
    await storeRefreshToken(user.id, `utc-contract-${randomUUID()}`);
    const after = Date.now();

    expectBetween(
      await storedInstant('refresh_tokens', 'created_at', 'user_id', user.id), before, after
    );
    const expiresAt = await storedInstant('refresh_tokens', 'expires_at', 'user_id', user.id);
    expect(Math.abs(expiresAt - expectedExpiry.getTime())).toBeLessThanOrEqual(TOLERANCE_MS);
  });

  test('createTestEstablishment: created_at and updated_at are the current UTC instant', async () => {
    const partner = await createTestUser({
      email: `utc-contract-partner-${randomUUID()}@test.com`,
      phone: null,
      password: 'Partner123!@#',
      name: 'UTC Contract Partner',
      role: 'partner',
    });

    const before = Date.now();
    const establishment = await createTestEstablishment(partner.id);
    const after = Date.now();

    for (const column of ['created_at', 'updated_at']) {
      expectBetween(
        await storedInstant('establishments', column, 'id', establishment.id), before, after
      );
    }
  });
});
