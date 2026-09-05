/**
 * OCR Service — Orchestrator
 *
 * Executes the full OCR pipeline for a single job:
 *   1. Fetch job + associated media
 *   2. For PDFs: try pdf-parse text extraction; if no usable text layer, fall back
 *      to vision OCR on each page via Cloudinary pg_N URLs
 *   3. For photos (file_type='image' with type='menu'): go directly to vision OCR
 *   4. Run the LLM structurer on raw text → array of menu items
 *   5. Run sanity checker with previous items as context (delta comparison)
 *   6. Transactionally replace menu_items for this media
 *   7. Mark job done (with result_summary) or failed (with retry logic)
 *   8. Notify partner once per upload batch via notifyMenuParsed — when the job
 *      that just settled was the last active one for the establishment
 *      (awaited, errors logged only, Segment B; see notifyPartnerIfBatchFinished)
 */

import logger from '../../utils/logger.js';
import * as ocrJobModel from '../../models/ocrJobModel.js';
import * as menuItemModel from '../../models/menuItemModel.js';
import * as MediaModel from '../../models/mediaModel.js';
import * as NotificationService from '../notificationService.js';
import * as pdfTextExtractor from './pdfTextExtractor.js';
import * as visionOcrAdapter from './visionOcrAdapter.js';
import * as llmStructurer from './llmStructurer.js';
import * as sanityChecker from './sanityChecker.js';
import { generatePdfPageImageUrl } from '../../config/cloudinary.js';

/**
 * Maximum pages to send to vision OCR when pdf-parse failed entirely and we can't
 * determine the real page count. Phase 1 safety valve — prevents runaway cost on
 * corrupted PDFs. Real page count from pdf-parse metadata is preferred.
 */
const VISION_FALLBACK_PAGE_LIMIT = 2;

/**
 * Upper bound of one job's wall-clock time, from the stage timeouts: the PDF
 * download (pdfTextExtractor.PDF_FETCH_TIMEOUT_MS), one vision call — all
 * pages go in a single request — and one structurer call; pdf-parse and the
 * DB writes are seconds at most. A download timeout falls back to vision OCR
 * (extractRawText — hence the sum includes the fallback path); a vision or
 * structurer timeout fails the job right there (markFailed). Either way a job
 * settles — done or failed — within this bound. server.js measures the
 * graceful-shutdown budget against it
 * (config/shutdown.js): ocrJobPoller.stop() waits for the job in flight, and
 * a job that outlives the budget dies with the process as a 'processing'
 * zombie for the stale sweep. Observed on production, July–August 2026
 * (84 jobs): p50 6.7 s, p99 30 s, max 38 s.
 */
const JOB_DURATION_BOUND_MS = pdfTextExtractor.PDF_FETCH_TIMEOUT_MS +
  visionOcrAdapter.REQUEST_TIMEOUT_MS +
  llmStructurer.REQUEST_TIMEOUT_MS;

/**
 * Build the list of image URLs to send to vision OCR, given a PDF media record.
 *
 * @param {Object} media - establishment_media row (file_type='pdf')
 * @param {number} knownPageCount - Page count from pdf-parse metadata, or 0 if unknown
 * @returns {string[]} Image URLs
 */
const buildPdfPageUrls = (media, knownPageCount) => {
  const pageCount = knownPageCount > 0
    ? knownPageCount
    : VISION_FALLBACK_PAGE_LIMIT;

  const urls = [];
  for (let page = 1; page <= pageCount; page++) {
    urls.push(generatePdfPageImageUrl(media.url, page));
  }
  return urls;
};

/**
 * Extract raw text from a media record by choosing the right strategy.
 *
 * @param {Object} media - establishment_media row
 * @returns {Promise<{ rawText: string, confidenceOverall: number | null, strategy: string }>}
 */
const extractRawText = async (media) => {
  if (media.file_type === 'pdf') {
    let parseResult = null;
    try {
      parseResult = await pdfTextExtractor.extractText(media.url);
    } catch (error) {
      logger.warn('pdf-parse failed, falling back to vision OCR', {
        mediaId: media.id,
        error: error.message,
      });
    }

    if (parseResult && parseResult.hasTextLayer) {
      return {
        rawText: parseResult.text,
        confidenceOverall: 0.95,
        strategy: 'pdf_text_layer',
      };
    }

    const pageUrls = buildPdfPageUrls(media, parseResult?.pageCount || 0);
    const visionResult = await visionOcrAdapter.extractFromImages(pageUrls);
    return {
      rawText: visionResult.rawText,
      confidenceOverall: visionResult.confidenceOverall,
      strategy: parseResult ? 'vision_pdf_fallback' : 'vision_pdf_no_metadata',
    };
  }

  if (media.file_type === 'image') {
    const visionResult = await visionOcrAdapter.extractFromImages([media.url]);
    return {
      rawText: visionResult.rawText,
      confidenceOverall: visionResult.confidenceOverall,
      strategy: 'vision_image',
    };
  }

  throw new Error(`Unsupported file_type for OCR: ${media.file_type}`);
};

/**
 * Compute result_summary metadata for admin observability.
 *
 * @param {Object[]} items - Items with sanity_flag applied
 * @param {string} strategy - Which extraction path was used
 * @returns {Object}
 */
const buildResultSummary = (items, strategy) => {
  const totalCount = items.length;
  const flaggedCount = items.filter((it) => it.sanity_flag !== null).length;

  const confidences = items
    .map((it) => (it.confidence == null ? null : Number(it.confidence)))
    .filter((c) => c != null);
  const confidenceAvg = confidences.length > 0
    ? Number((confidences.reduce((a, b) => a + b, 0) / confidences.length).toFixed(3))
    : null;

  return {
    strategy,
    items_count: totalCount,
    flagged_count: flaggedCount,
    confidence_avg: confidenceAvg,
  };
};

/**
 * Batch-level partner notification (Coordinator decision 2026-09-04, option «б»).
 *
 * A job is one menu file, but the partner uploads a menu: N files used to
 * yield N in-app rows and — once push arrived — N pushes spread over the
 * serial poller's run. Now the partner hears once, when the job that just
 * settled left no active (pending/processing) sibling for the establishment.
 *
 * A "batch" is therefore the set of jobs of one establishment that overlap in
 * the queue: whatever is still pending/processing while a job settles belongs
 * to the same batch. Files uploaded more than a poll cycle plus processing
 * time apart form separate batches and notify separately — by design, those
 * are separate uploads. A job that markFailed returned to 'pending' for a
 * retry keeps the batch open; whichever job settles last sends the
 * notification, and the text is computed from the whole menu at that moment
 * (notificationService). A 'processing' row older than
 * ocrJobModel.STALE_PROCESSING_INTERVAL is a zombie and does not hold the
 * batch open (see countActiveJobsForEstablishment); the poller's stale sweep
 * settles it later and, when that fails it permanently, closes the batch
 * through this same function (ocrJobPoller.sweepStaleJobs).
 *
 * The poller runs jobs one at a time, so the "no active jobs left" check that
 * follows markDone / markFailed cannot race with a sibling settling at the
 * same instant (ocrJobPoller header notes the multi-poller caveat).
 *
 * `failedJobId` marks the permanent-failure branch: the batch is reported only
 * if a batch mate was recognised while the failed job was alive (a 'done' job
 * completed after it was enqueued). A lone failed upload, or a batch that
 * failed entirely, stays silent — the retry flow covers it, as before.
 *
 * Known edge (accepted): deleting a menu file whose job is still pending
 * cascades the job away, so a sibling that already deferred never gets its
 * notification. The partner still sees the recognised items on the menu screen.
 *
 * Errors are logged and never reach the job outcome (callers attach .catch).
 *
 * @param {string} establishmentId - UUID
 * @param {Object} [options]
 * @param {string|null} [options.failedJobId] - Set when a permanent failure settled this job
 * @returns {Promise<boolean>} Whether the notification was sent
 */
const notifyPartnerIfBatchFinished = async (establishmentId, { failedJobId = null } = {}) => {
  const activeJobs = await ocrJobModel.countActiveJobsForEstablishment(establishmentId);
  if (activeJobs > 0) {
    logger.debug('menu_parsed notification deferred: batch still active', {
      establishmentId,
      activeJobs,
    });
    return false;
  }

  if (failedJobId) {
    const doneInBatch = await ocrJobModel.countDoneJobsSinceEnqueue({
      establishmentId,
      jobId: failedJobId,
    });
    if (doneInBatch === 0) {
      logger.debug('menu_parsed notification skipped: nothing recognised in the failed batch', {
        establishmentId,
        failedJobId,
      });
      return false;
    }
  }

  await NotificationService.notifyMenuParsed(establishmentId);
  return true;
};

/**
 * Run the full OCR pipeline for a job. Called by the poller after pickNextPending,
 * or directly in tests.
 *
 * On success: marks job 'done' and persists menu_items.
 * On any exception: marks job 'failed' (with retry if attempts < max_attempts).
 *
 * @param {string} jobId - UUID of a job in 'processing' status
 * @returns {Promise<{ success: boolean, jobId: string, itemCount?: number, error?: string }>}
 */
export const processJob = async (jobId) => {
  const job = await ocrJobModel.getJobStatus(jobId);
  if (!job) {
    logger.error('processJob called with unknown jobId', { jobId });
    return { success: false, jobId, error: 'job_not_found' };
  }

  try {
    const media = await MediaModel.findMediaById(job.media_id);
    if (!media) {
      throw new Error(`Media not found: ${job.media_id}`);
    }

    const { rawText, strategy } = await extractRawText(media);

    if (!rawText || rawText.trim().length === 0) {
      throw new Error(`OCR produced empty text via strategy=${strategy}`);
    }

    const rawItems = await llmStructurer.structureMenu(rawText);

    if (rawItems.length === 0) {
      logger.warn('LLM structurer returned 0 items', {
        jobId,
        mediaId: media.id,
        strategy,
        rawTextLength: rawText.length,
      });
    }

    const previousItems = await menuItemModel.getByEstablishmentId(job.establishment_id, {
      includeHidden: true,
    });
    const previousForThisMedia = previousItems.filter((it) => it.media_id === job.media_id);

    const flaggedItems = sanityChecker.check(rawItems, previousForThisMedia);

    await menuItemModel.replaceForMedia({
      establishmentId: job.establishment_id,
      mediaId: job.media_id,
      newItems: flaggedItems,
    });

    const summary = buildResultSummary(flaggedItems, strategy);

    await ocrJobModel.markDone(jobId, summary);

    logger.info('OCR job completed', {
      jobId,
      mediaId: media.id,
      ...summary,
    });

    // Segment B: notify partner once the whole upload batch has settled.
    // The job outcome is already persisted above and never depends on this:
    // errors are caught and logged. It is awaited (not fire-and-forget) so the
    // poller's in-flight promise — which graceful shutdown waits for before
    // closing the pool — covers the notification; a redeploy landing on the
    // last job of a batch must not leave the partner without it.
    await notifyPartnerIfBatchFinished(job.establishment_id)
      .catch((err) => logger.error('notifyMenuParsed failed', {
        error: err.message,
        establishmentId: job.establishment_id,
      }));

    return { success: true, jobId, itemCount: flaggedItems.length };
  } catch (error) {
    logger.error('OCR job failed', {
      jobId,
      error: error.message,
      stack: error.stack,
    });

    const failedJob = await ocrJobModel.markFailed(jobId, error.message);

    // A permanent failure settles this job too: if it was the last active one,
    // the partner still hears what the rest of the batch produced. Awaited for
    // the same shutdown reason as above; errors stay in the log.
    if (failedJob && failedJob.status === 'failed') {
      await notifyPartnerIfBatchFinished(job.establishment_id, { failedJobId: jobId })
        .catch((err) => logger.error('notifyMenuParsed failed after permanent failure', {
          error: err.message,
          establishmentId: job.establishment_id,
        }));
    }

    return { success: false, jobId, error: error.message };
  }
};

export {
  buildPdfPageUrls,
  buildResultSummary,
  notifyPartnerIfBatchFinished,
  JOB_DURATION_BOUND_MS,
  VISION_FALLBACK_PAGE_LIMIT,
};
