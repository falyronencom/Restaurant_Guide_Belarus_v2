/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: config/shutdown.js — graceful-shutdown budget.
 *
 * Pure function over an env map: the force-exit timer server.js arms must
 * fire before Railway's SIGKILL (RAILWAY_DEPLOYMENT_DRAINING_SECONDS, platform
 * default 0) and leave the OCR poller time for the job in flight.
 */

import {
  resolveShutdownBudget,
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  MIN_SHUTDOWN_TIMEOUT_MS,
  MAX_SHUTDOWN_TIMEOUT_MS,
  SHUTDOWN_SAFETY_MARGIN_MS,
} from '../../config/shutdown.js';

/** The OCR job bound as ocrService computes it: 60 s download + 60 s vision + 60 s structurer. */
const JOB_BOUND_MS = 180000;

/** Railway-provided variable that marks a Railway container, plus production. */
const RAILWAY_PROD = { RAILWAY_ENVIRONMENT_NAME: 'production', NODE_ENV: 'production' };

describe('resolveShutdownBudget', () => {
  test('nothing configured → the historical 30 s default, no drain known, no warnings outside production', () => {
    expect(resolveShutdownBudget({}, { jobBoundMs: JOB_BOUND_MS })).toEqual({
      timeoutMs: DEFAULT_SHUTDOWN_TIMEOUT_MS,
      source: 'default',
      drainingMs: null,
      onRailway: false,
      warnings: [],
    });
    expect(resolveShutdownBudget()).toMatchObject({ timeoutMs: 30000, source: 'default' });
  });

  test('the proposed Railway setting (200 s) → drain minus the safety margin, covers the OCR job bound, no warnings', () => {
    const budget = resolveShutdownBudget(
      { ...RAILWAY_PROD, RAILWAY_DEPLOYMENT_DRAINING_SECONDS: '200' },
      { jobBoundMs: JOB_BOUND_MS },
    );

    expect(budget).toEqual({
      timeoutMs: 200000 - SHUTDOWN_SAFETY_MARGIN_MS,
      source: 'RAILWAY_DEPLOYMENT_DRAINING_SECONDS',
      drainingMs: 200000,
      onRailway: true,
      warnings: [],
    });
    expect(budget.timeoutMs).toBeGreaterThanOrEqual(JOB_BOUND_MS);
  });

  test('on Railway without the variable → one warning: the kill is immediate, nothing else matters', () => {
    const unset = resolveShutdownBudget(RAILWAY_PROD, { jobBoundMs: JOB_BOUND_MS });
    expect(unset).toMatchObject({ timeoutMs: DEFAULT_SHUTDOWN_TIMEOUT_MS, source: 'default', drainingMs: null, onRailway: true });
    expect(unset.warnings).toHaveLength(1);
    expect(unset.warnings[0]).toContain('RAILWAY_DEPLOYMENT_DRAINING_SECONDS is not set');

    // Explicit zero is the platform default spelled out — same situation.
    const zero = resolveShutdownBudget(
      { ...RAILWAY_PROD, RAILWAY_DEPLOYMENT_DRAINING_SECONDS: '0' },
      { jobBoundMs: JOB_BOUND_MS },
    );
    expect(zero).toMatchObject({ timeoutMs: DEFAULT_SHUTDOWN_TIMEOUT_MS, drainingMs: 0 });
    expect(zero.warnings).toHaveLength(1);
    expect(zero.warnings[0]).toContain('is not set');
  });

  test('any Railway-provided marker variable counts as "on Railway"', () => {
    for (const marker of ['RAILWAY_ENVIRONMENT_NAME', 'RAILWAY_DEPLOYMENT_ID', 'RAILWAY_SERVICE_ID']) {
      expect(resolveShutdownBudget({ [marker]: 'x' }).onRailway).toBe(true);
    }
    expect(resolveShutdownBudget({ RAILWAY_ENVIRONMENT_NAME: '' }).onRailway).toBe(false);
  });

  test('a drain shorter than the OCR job bound → budget follows it and the warning names the value to set', () => {
    const budget = resolveShutdownBudget(
      { ...RAILWAY_PROD, RAILWAY_DEPLOYMENT_DRAINING_SECONDS: '60' },
      { jobBoundMs: JOB_BOUND_MS },
    );

    expect(budget.timeoutMs).toBe(55000);
    expect(budget.source).toBe('RAILWAY_DEPLOYMENT_DRAINING_SECONDS');
    expect(budget.warnings).toHaveLength(1);
    expect(budget.warnings[0]).toContain('below the OCR job bound 180000 ms');
    // (180 s + 5 s margin) / 1000, rounded up
    expect(budget.warnings[0]).toContain('RAILWAY_DEPLOYMENT_DRAINING_SECONDS >= 185');
  });

  test('a tiny drain → floored at the minimum, and the timer is reported as unable to beat the kill', () => {
    const budget = resolveShutdownBudget(
      { ...RAILWAY_PROD, RAILWAY_DEPLOYMENT_DRAINING_SECONDS: '5' },
      { jobBoundMs: JOB_BOUND_MS },
    );

    expect(budget.timeoutMs).toBe(MIN_SHUTDOWN_TIMEOUT_MS);
    expect(budget.warnings).toHaveLength(2);
    expect(budget.warnings[0]).toContain('leaves less than 5000 ms before the platform kill at 5000 ms');
    expect(budget.warnings[1]).toContain('below the OCR job bound');
  });

  test('explicit SHUTDOWN_TIMEOUT_MS wins over the drain; eating into the safety margin is reported', () => {
    const tooLong = resolveShutdownBudget(
      { ...RAILWAY_PROD, RAILWAY_DEPLOYMENT_DRAINING_SECONDS: '200', SHUTDOWN_TIMEOUT_MS: '250000' },
      { jobBoundMs: JOB_BOUND_MS },
    );
    expect(tooLong).toMatchObject({ timeoutMs: 250000, source: 'SHUTDOWN_TIMEOUT_MS', drainingMs: 200000 });
    expect(tooLong.warnings).toHaveLength(1);
    expect(tooLong.warnings[0]).toContain(
      'shutdown timer 250000 ms leaves less than 5000 ms before the platform kill at 200000 ms',
    );

    // 1 s of headroom is not the 5 s the derived budget keeps — same warning.
    const tooClose = resolveShutdownBudget(
      { ...RAILWAY_PROD, RAILWAY_DEPLOYMENT_DRAINING_SECONDS: '200', SHUTDOWN_TIMEOUT_MS: '199000' },
      { jobBoundMs: JOB_BOUND_MS },
    );
    expect(tooClose.timeoutMs).toBe(199000);
    expect(tooClose.warnings).toHaveLength(1);
    expect(tooClose.warnings[0]).toContain('leaves less than 5000 ms before the platform kill at 200000 ms');

    const fits = resolveShutdownBudget(
      { ...RAILWAY_PROD, RAILWAY_DEPLOYMENT_DRAINING_SECONDS: '200', SHUTDOWN_TIMEOUT_MS: '190000' },
      { jobBoundMs: JOB_BOUND_MS },
    );
    expect(fits).toMatchObject({ timeoutMs: 190000, source: 'SHUTDOWN_TIMEOUT_MS', warnings: [] });

    // Outside Railway the override simply applies.
    expect(resolveShutdownBudget({ SHUTDOWN_TIMEOUT_MS: '45000' })).toMatchObject({
      timeoutMs: 45000,
      source: 'SHUTDOWN_TIMEOUT_MS',
      drainingMs: null,
      warnings: [],
    });
  });

  test('malformed or zero values fall back instead of becoming 0', () => {
    expect(resolveShutdownBudget({ SHUTDOWN_TIMEOUT_MS: 'soon', RAILWAY_DEPLOYMENT_DRAINING_SECONDS: '12abc' }))
      .toMatchObject({ timeoutMs: DEFAULT_SHUTDOWN_TIMEOUT_MS, source: 'default', drainingMs: null });
    expect(resolveShutdownBudget({ SHUTDOWN_TIMEOUT_MS: '0', RAILWAY_DEPLOYMENT_DRAINING_SECONDS: '1e3' }))
      .toMatchObject({ timeoutMs: DEFAULT_SHUTDOWN_TIMEOUT_MS, source: 'default', drainingMs: null });
    expect(resolveShutdownBudget({ SHUTDOWN_TIMEOUT_MS: '-5', RAILWAY_DEPLOYMENT_DRAINING_SECONDS: ' 200 ' }))
      .toMatchObject({ timeoutMs: 195000, source: 'RAILWAY_DEPLOYMENT_DRAINING_SECONDS', drainingMs: 200000 });
  });

  test('an absurd drain is clamped to Node\'s setTimeout ceiling with a warning', () => {
    const budget = resolveShutdownBudget(
      { ...RAILWAY_PROD, RAILWAY_DEPLOYMENT_DRAINING_SECONDS: '9'.repeat(12) },
      { jobBoundMs: JOB_BOUND_MS },
    );

    expect(budget.timeoutMs).toBe(MAX_SHUTDOWN_TIMEOUT_MS);
    expect(MAX_SHUTDOWN_TIMEOUT_MS).toBe(2147483647);
    expect(budget.warnings).toEqual([expect.stringContaining('exceeds Node\'s setTimeout ceiling')]);
  });

  test('a job bound that is not a finite positive number is reported, not silently ignored', () => {
    for (const bad of [NaN, Infinity, -1]) {
      const budget = resolveShutdownBudget(
        { ...RAILWAY_PROD, RAILWAY_DEPLOYMENT_DRAINING_SECONDS: '60' },
        { jobBoundMs: bad },
      );
      expect(budget.timeoutMs).toBe(55000);
      expect(budget.warnings).toEqual([expect.stringContaining('OCR job bound is not a finite positive number')]);
    }
    // 0 / null / undefined mean "no bound given" — no check, no warning.
    for (const none of [0, null, undefined]) {
      expect(resolveShutdownBudget({ ...RAILWAY_PROD, RAILWAY_DEPLOYMENT_DRAINING_SECONDS: '60' }, { jobBoundMs: none }).warnings)
        .toEqual([]);
    }
  });

  test('the OCR-bound warning is a production signal: silent in development, silent when no bound is given', () => {
    expect(resolveShutdownBudget({ NODE_ENV: 'production' }, { jobBoundMs: JOB_BOUND_MS }).warnings).toEqual([
      expect.stringContaining('below the OCR job bound'),
    ]);
    expect(resolveShutdownBudget({ NODE_ENV: 'development' }, { jobBoundMs: JOB_BOUND_MS }).warnings).toEqual([]);
    expect(resolveShutdownBudget({ NODE_ENV: 'production' }).warnings).toEqual([]);
  });
});
