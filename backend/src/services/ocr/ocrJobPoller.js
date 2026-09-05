/**
 * OCR Job Poller
 *
 * Background loop that periodically picks up pending OCR jobs from the database
 * and feeds them to the orchestrator. Serial processing (one job at a time) —
 * sufficient for Phase 1 volumes, easy to scale horizontally later by simply
 * running multiple pollers (FOR UPDATE SKIP LOCKED handles concurrency).
 *
 * Caveat before adding pollers: the batch-level partner notification in
 * ocrService (one menu_parsed per upload batch, 2026-09-04) relies on serial
 * processing — with several pollers two jobs of one establishment settling at
 * the same instant could both see "no active jobs left" and notify twice
 * (a duplicate, never silence). Serialise the check per establishment first.
 *
 * Stale-job sweep (reaper, 2026-09-04): a 'processing' row whose process died
 * mid-job (SIGKILL / OOM / redeploy without a graceful stop) is settled by
 * nobody — pickNextPending only takes 'pending' rows. Left alone it makes
 * ocrJobModel.enqueue treat the media as "already in flight" forever (re-run
 * OCR silently returns the zombie) and hides the establishment from the admin
 * "empty menus" signal. The sweep runs once at start() — the previous process
 * is the usual source of zombies — and then every STALE_SWEEP_INTERVAL_MS from
 * within the poll cycle, whether or not a job is in flight: a long backlog
 * must not starve it. Rows older than ocrJobModel.STALE_PROCESSING_INTERVAL go
 * back to 'pending' (attempts left) or to 'failed' (last attempt spent) under
 * the same retry rule as markFailed, and a permanent failure closes the upload
 * batch exactly as processJob does. The job in flight in this process is never
 * that old (the PDF download, the vision call and the structurer call each
 * abort after 60 s — ocrService.JOB_DURATION_BOUND_MS is 180 s, far below the
 * interval; see STALE_PROCESSING_INTERVAL in the model), so the sweep and the
 * running job touch disjoint rows.
 *
 * Lifecycle:
 *   - start() runs one sweep immediately and begins the polling interval
 *   - stop() stops new pickups and waits for the cycle in progress, the
 *     current job and the current sweep (if any) to finish — the job and the
 *     sweep both await the batch notification, so closePool() in server.js
 *     cannot cut it off
 *
 * The poller must NOT start in NODE_ENV=test — tests invoke ocrService.processJob
 * and sweepStaleJobs directly to avoid timing dependencies.
 */

import logger from '../../utils/logger.js';
import * as ocrJobModel from '../../models/ocrJobModel.js';
import * as ocrService from './ocrService.js';

const DEFAULT_INTERVAL_MS = 10000;

/**
 * How often the poll cycle re-runs the stale sweep. A zombie is at least
 * STALE_PROCESSING_INTERVAL old before it qualifies, so minutes of extra
 * latency change nothing; the value keeps the extra UPDATE off the
 * 10-second poll path.
 */
const STALE_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

let intervalId = null;
let currentJobPromise = null;
let sweepPromise = null;
let lastSweepAt = 0;
let tickPromise = null;
let stopRequested = false;

/**
 * Settle every 'processing' row older than STALE_PROCESSING_INTERVAL.
 *
 * Each reaped job is logged at warn level. A job the sweep failed permanently
 * closes its upload batch the way processJob's permanent failure does:
 * notifyPartnerIfBatchFinished with failedJobId, awaited, errors logged only.
 * When several permanently failed rows of one establishment are reaped in the
 * same pass, the batch is closed once, from the oldest of them (the widest
 * "recognised since enqueue" window). Rows reaped back to 'pending' keep the
 * batch open — the retry settles it, as with markFailed.
 *
 * Exported for tests and diagnostics; the poller schedules it itself.
 *
 * @returns {Promise<Object[]>} The reaped job rows, now 'pending' or 'failed'
 */
export const sweepStaleJobs = async () => {
  const reaped = await ocrJobModel.reapStaleProcessingJobs();

  for (const job of reaped) {
    logger.warn('OCR poller: stale processing job reaped', {
      jobId: job.id,
      establishmentId: job.establishment_id,
      mediaId: job.media_id,
      attempts: job.attempts,
      maxAttempts: job.max_attempts,
      outcome: job.status,
      staleAfter: ocrJobModel.STALE_PROCESSING_INTERVAL,
    });
  }

  const closedBatches = new Set();
  for (const job of reaped) {
    if (job.status !== 'failed' || closedBatches.has(job.establishment_id)) {
      continue;
    }
    closedBatches.add(job.establishment_id);
    await ocrService.notifyPartnerIfBatchFinished(job.establishment_id, { failedJobId: job.id })
      .catch((error) => logger.error('notifyMenuParsed failed after stale job reaped', {
        error: error.message,
        establishmentId: job.establishment_id,
        jobId: job.id,
      }));
  }

  return reaped;
};

/**
 * Run the sweep when STALE_SWEEP_INTERVAL_MS has passed since the last one.
 * Never overlaps with itself; errors are logged and never reach the caller.
 *
 * @returns {Promise<void>|null} The in-flight sweep, or null when not due
 */
const runStaleSweepIfDue = () => {
  if (sweepPromise) {
    return sweepPromise;
  }
  if (Date.now() - lastSweepAt < STALE_SWEEP_INTERVAL_MS) {
    return null;
  }

  lastSweepAt = Date.now();
  sweepPromise = sweepStaleJobs()
    .catch((error) => {
      logger.error('OCR poller: stale sweep failed', { error: error.message });
    })
    .finally(() => {
      sweepPromise = null;
    });
  return sweepPromise;
};

/**
 * One poll cycle: run the stale sweep when due, then process exactly one
 * pending job if available. Never runs twice at once — see tick().
 */
const runTick = async () => {
  await runStaleSweepIfDue();

  // stop() may have been requested while the sweep ran: graceful shutdown
  // must not start a job that closePool() would then cut off.
  if (stopRequested || currentJobPromise) {
    return;
  }

  let job;
  try {
    job = await ocrJobModel.pickNextPending();
  } catch (error) {
    logger.error('OCR poller: pickNextPending failed', { error: error.message });
    return;
  }

  if (!job) {
    return;
  }

  currentJobPromise = ocrService.processJob(job.id)
    .catch((error) => {
      logger.error('OCR poller: unexpected error bubbled from processJob', {
        jobId: job.id,
        error: error.message,
      });
    })
    .finally(() => {
      currentJobPromise = null;
    });
};

/**
 * Interval callback. Overlapping calls — the interval firing while the
 * previous cycle still awaits the sweep or the pick — join the running cycle
 * instead of starting a second one: two concurrent picks would run two jobs
 * at once and break the serial-processing invariant the batch notification
 * relies on (Phase 3.5 review, 2026-09-04). The job itself runs on past the
 * cycle (currentJobPromise), so later cycles still sweep while it is in
 * flight; they only skip the pick.
 *
 * @returns {Promise<void>}
 */
const tick = () => {
  if (tickPromise) {
    return tickPromise;
  }
  tickPromise = runTick().finally(() => {
    tickPromise = null;
  });
  return tickPromise;
};

/**
 * Start the polling interval. Idempotent — calling start() twice has no effect.
 * Sweeps stale jobs immediately: the process that just died is the usual
 * source of them, and a reset job is then picked by the first cycle.
 *
 * @param {Object} options
 * @param {number} options.intervalMs - Poll interval (default from POLLER_INTERVAL_MS env or 10000)
 */
export const start = ({ intervalMs } = {}) => {
  if (intervalId !== null) {
    logger.warn('OCR poller already running — start() ignored');
    return;
  }

  const envInterval = parseInt(process.env.POLLER_INTERVAL_MS || '', 10);
  const resolvedInterval = intervalMs
    || (Number.isFinite(envInterval) && envInterval > 0 ? envInterval : DEFAULT_INTERVAL_MS);

  stopRequested = false;
  intervalId = setInterval(() => {
    tick().catch((error) => {
      logger.error('OCR poller: tick error', { error: error.message });
    });
  }, resolvedInterval);

  logger.info('OCR poller started', {
    intervalMs: resolvedInterval,
    staleSweepIntervalMs: STALE_SWEEP_INTERVAL_MS,
  });

  lastSweepAt = 0;
  runStaleSweepIfDue();
};

/**
 * Stop the poller. Waits for the cycle in progress, the currently processing
 * job and the in-flight stale sweep (if any) to finish. Called during
 * graceful shutdown.
 *
 * @returns {Promise<void>}
 */
export const stop = async () => {
  stopRequested = true;

  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info('OCR poller interval cleared');
  }

  // A cycle caught mid-sweep starts no job (stopRequested); one caught
  // mid-pick finishes the pick, and its job is then covered by the wait below.
  if (tickPromise) {
    try {
      await tickPromise;
    } catch (_err) {
      // Errors already logged inside runTick() / the interval callback
    }
  }

  if (currentJobPromise) {
    logger.info('OCR poller: waiting for in-flight job to complete');
    try {
      await currentJobPromise;
    } catch (_err) {
      // Errors already logged inside runTick()
    }
  }

  if (sweepPromise) {
    logger.info('OCR poller: waiting for in-flight stale sweep to complete');
    // Errors already logged inside runStaleSweepIfDue()
    await sweepPromise;
  }
};

/**
 * Introspection helper for tests and diagnostics.
 *
 * @returns {{ running: boolean, busy: boolean, sweeping: boolean }}
 */
export const status = () => ({
  running: intervalId !== null,
  busy: currentJobPromise !== null,
  sweeping: sweepPromise !== null,
});

export { DEFAULT_INTERVAL_MS, STALE_SWEEP_INTERVAL_MS, tick };
