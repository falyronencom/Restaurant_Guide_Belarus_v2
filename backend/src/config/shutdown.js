/**
 * Graceful-shutdown budget
 *
 * How long server.js lets a shutdown run before forcing the exit. The number
 * has to satisfy two platform facts at once (Coordinator decision 2026-09-05,
 * option «б» — align the windows):
 *
 *   1. Railway sends SIGTERM to the previous deployment once the new one is
 *      Active and SIGKILLs it after RAILWAY_DEPLOYMENT_DRAINING_SECONDS — a
 *      service variable whose platform default is 0
 *      (docs.railway.com/reference/deployments, checked 2026-09-05). A timer
 *      that would fire after that kill is decoration.
 *   2. ocrJobPoller.stop() waits for the OCR job in flight, which is bounded
 *      by the stage timeouts (ocrService.JOB_DURATION_BOUND_MS, about 180 s).
 *      A job that dies with the container is left as a 'processing' zombie
 *      for the stale sweep to settle about an hour later, one attempt burnt.
 *
 * Resolution order (first match wins), never below MIN_SHUTDOWN_TIMEOUT_MS
 * and never above MAX_SHUTDOWN_TIMEOUT_MS:
 *   1. SHUTDOWN_TIMEOUT_MS — explicit override, milliseconds
 *   2. RAILWAY_DEPLOYMENT_DRAINING_SECONDS minus SHUTDOWN_SAFETY_MARGIN_MS —
 *      Railway injects service variables into the container, so the timer
 *      follows the platform setting without a code change
 *   3. DEFAULT_SHUTDOWN_TIMEOUT_MS — the historical 30 s
 *
 * Pure: reads the env object it is given, never process.env, and returns
 * the warnings instead of logging them — server.js logs them at startup.
 */

/** Historical default, used when neither variable is set (local runs). */
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 30000;

/** Below this a shutdown cannot even close the pool cleanly. */
export const MIN_SHUTDOWN_TIMEOUT_MS = 5000;

/**
 * Headroom between the force-exit timer and the platform's SIGKILL: the
 * timer's own exit path (a log line, process.exit) must land before the kill.
 */
export const SHUTDOWN_SAFETY_MARGIN_MS = 5000;

/**
 * Node's setTimeout ceiling (2^31 − 1 ms, about 24.8 days). A larger delay
 * fires after 1 ms with a TimeoutOverflowWarning — a forced exit on every
 * SIGTERM. Only a nonsensical drain value gets near it; clamped with a warning.
 */
export const MAX_SHUTDOWN_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * Railway-provided variables present in every Railway container
 * (docs.railway.com/variables/reference). Any of them means "on Railway".
 */
const RAILWAY_MARKER_VARIABLES = [
  'RAILWAY_ENVIRONMENT_NAME',
  'RAILWAY_DEPLOYMENT_ID',
  'RAILWAY_SERVICE_ID',
];

/**
 * Strict non-negative integer parse: '200' → 200; undefined, '', '12abc' and
 * '1e3' → null. Strictness matters — a typo must fall back, not become 0.
 *
 * @param {*} value
 * @returns {number|null}
 */
const parseNonNegativeInt = (value) => {
  if (value === undefined || value === null) {
    return null;
  }
  const text = String(value).trim();
  return /^\d+$/.test(text) ? Number.parseInt(text, 10) : null;
};

/**
 * Resolve the shutdown budget from the environment.
 *
 * @param {Object} [env] - Environment map (process.env in production)
 * @param {Object} [options]
 * @param {number} [options.jobBoundMs=0] - Upper bound of one OCR job in ms; 0 skips the check
 * @returns {{
 *   timeoutMs: number,
 *   source: 'SHUTDOWN_TIMEOUT_MS'|'RAILWAY_DEPLOYMENT_DRAINING_SECONDS'|'default',
 *   drainingMs: number|null,
 *   onRailway: boolean,
 *   warnings: string[],
 * }} drainingMs is null when the variable is absent or malformed, 0 when explicitly zero
 */
export const resolveShutdownBudget = (env = {}, { jobBoundMs = 0 } = {}) => {
  const drainingSeconds = parseNonNegativeInt(env.RAILWAY_DEPLOYMENT_DRAINING_SECONDS);
  const drainingMs = drainingSeconds === null ? null : drainingSeconds * 1000;
  const drainKnown = drainingMs !== null && drainingMs > 0;
  const onRailway = RAILWAY_MARKER_VARIABLES.some((name) => Boolean(env[name]));
  const override = parseNonNegativeInt(env.SHUTDOWN_TIMEOUT_MS);

  let timeoutMs;
  let source;
  if (override !== null && override > 0) {
    timeoutMs = override;
    source = 'SHUTDOWN_TIMEOUT_MS';
  } else if (drainKnown) {
    timeoutMs = drainingMs - SHUTDOWN_SAFETY_MARGIN_MS;
    source = 'RAILWAY_DEPLOYMENT_DRAINING_SECONDS';
  } else {
    timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS;
    source = 'default';
  }
  timeoutMs = Math.max(timeoutMs, MIN_SHUTDOWN_TIMEOUT_MS);

  const warnings = [];
  if (timeoutMs > MAX_SHUTDOWN_TIMEOUT_MS) {
    warnings.push(
      `shutdown timer ${timeoutMs} ms exceeds Node's setTimeout ceiling ` +
      `${MAX_SHUTDOWN_TIMEOUT_MS} ms and was clamped to it`,
    );
    timeoutMs = MAX_SHUTDOWN_TIMEOUT_MS;
  }

  // A bound that is given but not a finite positive number is a code defect
  // (a renamed summand yields NaN and NaN never trips a comparison) — say so
  // instead of silently disabling the check.
  const boundGiven = jobBoundMs !== undefined && jobBoundMs !== null && jobBoundMs !== 0;
  const boundKnown = boundGiven && Number.isFinite(jobBoundMs) && jobBoundMs > 0;
  if (boundGiven && !boundKnown) {
    warnings.push(
      `OCR job bound is not a finite positive number (${jobBoundMs}): the bound check is disabled — ` +
      'check ocrService.JOB_DURATION_BOUND_MS and its summands',
    );
  }

  if (onRailway && !drainKnown) {
    // Nothing below matters until the drain exists: the kill is immediate.
    warnings.push(
      'RAILWAY_DEPLOYMENT_DRAINING_SECONDS is not set on this Railway service: ' +
      'the process is killed right after SIGTERM, graceful shutdown never runs ' +
      'and an OCR job in flight at redeploy is left to the stale sweep',
    );
  } else {
    // The derived budget keeps the margin by construction; an override or a
    // floored tiny drain may not — the timer's own exit path needs it.
    if (drainKnown && timeoutMs > drainingMs - SHUTDOWN_SAFETY_MARGIN_MS) {
      warnings.push(
        `shutdown timer ${timeoutMs} ms leaves less than ${SHUTDOWN_SAFETY_MARGIN_MS} ms ` +
        `before the platform kill at ${drainingMs} ms: ` +
        'lower SHUTDOWN_TIMEOUT_MS or raise RAILWAY_DEPLOYMENT_DRAINING_SECONDS',
      );
    }
    if (boundKnown && timeoutMs < jobBoundMs && env.NODE_ENV === 'production') {
      const neededSeconds = Math.ceil((jobBoundMs + SHUTDOWN_SAFETY_MARGIN_MS) / 1000);
      warnings.push(
        `shutdown budget ${timeoutMs} ms is below the OCR job bound ${jobBoundMs} ms: ` +
        'a job in flight at redeploy may be killed; ' +
        `set RAILWAY_DEPLOYMENT_DRAINING_SECONDS >= ${neededSeconds}`,
      );
    }
  }

  return { timeoutMs, source, drainingMs, onRailway, warnings };
};
