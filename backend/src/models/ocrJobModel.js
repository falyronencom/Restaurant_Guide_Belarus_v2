/**
 * OCR Job Model
 *
 * Persistent background job queue for OCR menu processing.
 * Uses PostgreSQL with FOR UPDATE SKIP LOCKED for safe concurrent polling.
 *
 * Table: ocr_jobs
 * Status flow: pending → processing → (done | failed)
 * Retry: markFailed returns job to 'pending' if attempts < max_attempts (default 3),
 *        otherwise transitions to 'failed' permanently.
 * Reaper: reapStaleProcessingJobs applies the same rule to 'processing' rows older
 *         than STALE_PROCESSING_INTERVAL — a process that died mid-job never settles
 *         its own row; ocrJobPoller sweeps them.
 */

import pool from '../config/database.js';
import logger from '../utils/logger.js';

/**
 * Enqueue an OCR job for a media file.
 *
 * Idempotency: if an active (pending/processing) job already exists for this media,
 * return it instead of creating a duplicate. This makes trigger logic in Segment B
 * safe against repeated calls (e.g., partner clicking "re-run OCR" twice).
 * A 'processing' row orphaned by a dead process would satisfy this check forever;
 * the poller's stale sweep (reapStaleProcessingJobs) settles it within about an hour.
 *
 * @param {Object} params
 * @param {string} params.establishmentId - UUID
 * @param {string} params.mediaId - UUID of establishment_media row
 * @returns {Promise<Object>} Job row (either newly created or pre-existing active)
 */
export const enqueue = async ({ establishmentId, mediaId }) => {
  const existing = await pool.query(
    `SELECT * FROM ocr_jobs
     WHERE media_id = $1 AND status IN ('pending', 'processing')
     ORDER BY created_at DESC
     LIMIT 1`,
    [mediaId],
  );

  if (existing.rows.length > 0) {
    logger.debug('OCR job already active for media, returning existing', {
      jobId: existing.rows[0].id,
      mediaId,
      status: existing.rows[0].status,
    });
    return existing.rows[0];
  }

  const result = await pool.query(
    `INSERT INTO ocr_jobs (establishment_id, media_id, status, attempts)
     VALUES ($1, $2, 'pending', 0)
     RETURNING *`,
    [establishmentId, mediaId],
  );

  logger.info('OCR job enqueued', {
    jobId: result.rows[0].id,
    establishmentId,
    mediaId,
  });

  return result.rows[0];
};

/**
 * Atomically pick the next pending job and mark it as processing.
 *
 * Uses FOR UPDATE SKIP LOCKED so multiple pollers (if we ever run several) never
 * grab the same job. Increments attempts counter as part of the pick — markFailed
 * then checks attempts >= max_attempts to decide final 'failed' vs retry 'pending'.
 *
 * @returns {Promise<Object|null>} Job row or null if no pending jobs
 */
export const pickNextPending = async () => {
  const result = await pool.query(
    `UPDATE ocr_jobs
     SET status = 'processing',
         started_at = NOW(),
         attempts = attempts + 1
     WHERE id = (
       SELECT id FROM ocr_jobs
       WHERE status = 'pending'
       ORDER BY created_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     RETURNING *`,
  );

  return result.rows[0] || null;
};

/**
 * Mark a job as successfully completed.
 *
 * @param {string} jobId - UUID
 * @param {Object} resultSummary - Metadata (items_count, confidence_avg, etc.) for admin observability
 * @returns {Promise<Object|null>} Updated job row or null if not found
 */
export const markDone = async (jobId, resultSummary) => {
  const result = await pool.query(
    `UPDATE ocr_jobs
     SET status = 'done',
         result_summary = $2,
         completed_at = NOW(),
         error_message = NULL
     WHERE id = $1
     RETURNING *`,
    [jobId, resultSummary],
  );

  return result.rows[0] || null;
};

/**
 * SET clause that settles a failed attempt — shared by markFailed and
 * reapStaleProcessingJobs so the retry rule lives in one place: back to
 * 'pending' while attempts remain (started_at cleared for the next pick),
 * 'failed' with completed_at once the last attempt is spent (started_at kept
 * for forensics). attempts was incremented by pickNextPending, so the
 * comparison is >= max_attempts. Placeholder contract: $2 = error message.
 */
const SETTLE_FAILED_ATTEMPT_SET = `SET status = CASE
           WHEN attempts >= max_attempts THEN 'failed'
           ELSE 'pending'
         END,
         error_message = $2,
         completed_at = CASE
           WHEN attempts >= max_attempts THEN NOW()
           ELSE NULL
         END,
         started_at = CASE
           WHEN attempts >= max_attempts THEN started_at
           ELSE NULL
         END`;

/**
 * Mark a job as failed. Retries if attempts < max_attempts, permanently fails otherwise.
 *
 * Note: attempts counter is incremented in pickNextPending, so by the time markFailed
 * runs, attempts already reflects the current try. The comparison is >= max_attempts.
 *
 * @param {string} jobId - UUID
 * @param {string} errorMessage - Human-readable failure reason
 * @returns {Promise<Object|null>} Updated job row or null if not found
 */
export const markFailed = async (jobId, errorMessage) => {
  const result = await pool.query(
    `UPDATE ocr_jobs
     ${SETTLE_FAILED_ATTEMPT_SET}
     WHERE id = $1
     RETURNING *`,
    [jobId, errorMessage],
  );

  return result.rows[0] || null;
};

/**
 * Get job status by ID.
 *
 * @param {string} jobId - UUID
 * @returns {Promise<Object|null>} Job row or null
 */
export const getJobStatus = async (jobId) => {
  const result = await pool.query(
    'SELECT * FROM ocr_jobs WHERE id = $1',
    [jobId],
  );
  return result.rows[0] || null;
};

/**
 * Get all jobs for an establishment, newest first.
 * Used for admin monitoring dashboards (Segment B).
 *
 * @param {string} establishmentId - UUID
 * @returns {Promise<Object[]>} Array of jobs
 */
export const getJobsByEstablishment = async (establishmentId) => {
  const result = await pool.query(
    `SELECT * FROM ocr_jobs
     WHERE establishment_id = $1
     ORDER BY created_at DESC`,
    [establishmentId],
  );
  return result.rows;
};

/**
 * Check whether a media file has any completed (done) OCR job.
 * Used by the admin-approve backfill trigger — if establishment is being approved
 * and has PDF menus without a 'done' job, enqueue fresh ones.
 *
 * @param {string} mediaId - UUID
 * @returns {Promise<boolean>}
 */
export const hasCompletedJobForMedia = async (mediaId) => {
  const result = await pool.query(
    `SELECT 1 FROM ocr_jobs
     WHERE media_id = $1 AND status = 'done'
     LIMIT 1`,
    [mediaId],
  );
  return result.rowCount > 0;
};

/**
 * A 'processing' row older than this is a zombie: the process died mid-job
 * (SIGKILL / OOM / redeploy without a graceful stop) and nothing else will
 * ever settle it. A legitimate job is minutes at most: one PDF download, one
 * vision call and one structurer call, each aborted after 60 s
 * (ocrService.JOB_DURATION_BOUND_MS = 180 s).
 * Two consumers: countActiveJobsForEstablishment ignores such rows so a
 * zombie cannot mute the batch notification, and reapStaleProcessingJobs
 * (driven by ocrJobPoller's sweep) settles them. PostgreSQL interval literal.
 */
export const STALE_PROCESSING_INTERVAL = '1 hour';

/**
 * error_message written by the reaper. English like the exception messages
 * markFailed stores; the column is not surfaced to partners or moderators.
 */
export const STALE_REAP_ERROR_MESSAGE = `stale processing reaped after ${STALE_PROCESSING_INTERVAL}`;

/**
 * Settle every zombie: 'processing' rows older than STALE_PROCESSING_INTERVAL.
 *
 * Same rule as markFailed — back to 'pending' while attempts remain (the
 * poller re-picks them; started_at is cleared and set again by
 * pickNextPending), 'failed' with completed_at once the last attempt is
 * spent. Left alone, such a row makes enqueue treat the media as active
 * forever and keeps the establishment out of the admin health signals'
 * "empty menus" anti-join. The age is compared inside the database —
 * started_at / created_at are DB-generated naive timestamps — with the
 * interval bound as a literal, exactly like countActiveJobsForEstablishment.
 *
 * Called by ocrJobPoller.sweepStaleJobs, which logs each row and closes the
 * batch of a permanently failed one. Rows come back oldest first so the
 * poller closes one batch per establishment deterministically.
 *
 * @returns {Promise<Object[]>} Reaped rows, now 'pending' or 'failed'
 */
export const reapStaleProcessingJobs = async () => {
  const result = await pool.query(
    `WITH reaped AS (
       UPDATE ocr_jobs
       ${SETTLE_FAILED_ATTEMPT_SET}
       WHERE status = 'processing'
         AND COALESCE(started_at, created_at) < NOW() - $1::interval
       RETURNING *
     )
     SELECT * FROM reaped ORDER BY created_at ASC`,
    [STALE_PROCESSING_INTERVAL, STALE_REAP_ERROR_MESSAGE],
  );
  return result.rows;
};

/**
 * Count active OCR jobs of an establishment: every 'pending' job plus the
 * 'processing' jobs younger than STALE_PROCESSING_INTERVAL.
 *
 * Batch detection for the partner notification (Coordinator decision
 * 2026-09-04, option «б» — one menu_parsed per upload batch, not per file):
 * ocrService notifies only when the job that just settled left no active
 * sibling behind. A job returned to 'pending' by markFailed for a retry still
 * counts as active, so the batch stays open until its last attempt settles.
 * A zombie 'processing' row is ignored — counting it would mute the
 * notification for this establishment for good. The age is compared inside
 * the database (started_at is DB-generated, naive timestamp).
 *
 * @param {string} establishmentId - UUID
 * @returns {Promise<number>}
 */
export const countActiveJobsForEstablishment = async (establishmentId) => {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count FROM ocr_jobs
     WHERE establishment_id = $1
       AND (
         status = 'pending'
         OR (status = 'processing'
             AND COALESCE(started_at, created_at) > NOW() - $2::interval)
       )`,
    [establishmentId, STALE_PROCESSING_INTERVAL],
  );
  return result.rows[0]?.count ?? 0;
};

/**
 * Count jobs of an establishment that finished successfully since a given job
 * was enqueued — the "batch mates" of that job that yielded a result.
 *
 * Used when a permanent failure closes a batch: the partner is told what the
 * other files produced only if at least one of them was recognised while the
 * failed job was alive. A lone failed upload, or a batch that failed entirely,
 * stays silent (as it did before batch notifications existed).
 *
 * The comparison runs inside the database on two DB-generated naive
 * timestamps — nothing crosses the driver's timezone boundary.
 *
 * @param {Object} params
 * @param {string} params.establishmentId - UUID
 * @param {string} params.jobId - UUID of the reference (failed) job
 * @returns {Promise<number>}
 */
export const countDoneJobsSinceEnqueue = async ({ establishmentId, jobId }) => {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count FROM ocr_jobs
     WHERE establishment_id = $1
       AND status = 'done'
       AND completed_at >= (SELECT created_at FROM ocr_jobs WHERE id = $2)`,
    [establishmentId, jobId],
  );
  return result.rows[0]?.count ?? 0;
};
