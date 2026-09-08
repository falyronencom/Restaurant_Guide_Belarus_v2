/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Guard: every admin route is placed into an access tier.
 *
 * Why a static guard and not only HTTP tests: the split between `readAccess`
 * (admin + viewer) and `writeAccess` (admin only) is applied per route, by
 * hand, in adminRoutes.js. A new mutation registered with `readAccess` — or
 * with the old raw `authorize(['admin'])` on a GET — changes nothing in the
 * output of any existing HTTP test: those exercise one representative route
 * per group. The drift would surface only when a viewer pressed the button.
 *
 * So this test reads the route file itself and requires, for every
 * registered route: exactly one tier, and the tier that follows from the
 * method — GET reads, everything else acts — with an explicit allow-list for
 * reads that exist only to serve an action and therefore stay admin-only.
 *
 * How to switch it off without changing the run's output? Only by editing
 * the allow-list below, which is the point: the exception must be written
 * down next to the rule.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROUTES_FILE = resolve(__dirname, '../../routes/v1/adminRoutes.js');

/**
 * Reads that only serve an action and stay in the action tier.
 *   /users/search — exists for "assign a partner" and returns e-mails and
 *   phones of platform users; a viewer has no action to serve with it.
 */
const ACTION_TIER_READS = new Set(['/users/search']);

/** Public routes of the file: no authenticate, no tier (rate-limited login). */
const PUBLIC_ROUTES = new Set(['/auth/login']);

const parseRoutes = (source) => {
  const pattern = /router\.(get|post|put|patch|delete)\(\s*'([^']+)'([\s\S]*?)\);/g;
  return [...source.matchAll(pattern)].map((m) => ({
    method: m[1],
    path: m[2],
    body: m[3],
  }));
};

describe('adminRoutes.js access tiers', () => {
  const source = readFileSync(ROUTES_FILE, 'utf8');
  const routes = parseRoutes(source);

  test('the parser still sees the routes (else every check below is vacuous)', () => {
    const registrations = (source.match(/router\.(get|post|put|patch|delete)\(/g) || []).length;
    expect(routes.length).toBeGreaterThan(20);
    expect(routes.length).toBe(registrations);
  });

  test('the raw authorize([...]) form is gone from the file', () => {
    // Every route goes through the two named tiers; a raw literal would be
    // a third, unclassified tier.
    expect(source).not.toMatch(/authorize\(\[/);
  });

  test('public routes carry neither authenticate nor a tier', () => {
    for (const route of routes.filter((r) => PUBLIC_ROUTES.has(r.path))) {
      expect(route.body).not.toMatch(/authenticate/);
      expect(route.body).not.toMatch(/readAccess|writeAccess/);
    }
  });

  test.each(
    parseRoutes(readFileSync(ROUTES_FILE, 'utf8'))
      .filter((r) => !PUBLIC_ROUTES.has(r.path))
      .map((r) => [`${r.method.toUpperCase()} ${r.path}`, r])
  )('%s is authenticated and sits in exactly one tier that matches its method', (_label, route) => {
    expect(route.body).toMatch(/\bauthenticate,/);

    const reads = (route.body.match(/\breadAccess,/g) || []).length;
    const writes = (route.body.match(/\bwriteAccess,/g) || []).length;
    expect(reads + writes).toBe(1);

    const expectedTier = route.method === 'get' && !ACTION_TIER_READS.has(route.path)
      ? 'readAccess'
      : 'writeAccess';
    expect(reads === 1 ? 'readAccess' : 'writeAccess').toBe(expectedTier);
  });

  test('the allow-list names only routes that exist', () => {
    const paths = new Set(routes.map((r) => r.path));
    for (const allowed of ACTION_TIER_READS) {
      expect(paths.has(allowed)).toBe(true);
    }
  });
});
