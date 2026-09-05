/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Integration test: OCR menu pipeline end-to-end.
 *
 * Exercises: enqueue → pickNextPending → processJob → menu_items persistence,
 * with pdf-parse and OpenRouter fetch calls mocked at the module boundary.
 *
 * The real DB is used — migration 024 must be applied to restaurant_guide_test
 * for this suite to run.
 */

import { jest } from '@jest/globals';
import { randomUUID } from 'crypto';

jest.unstable_mockModule('pdf-parse/lib/pdf-parse.js', () => ({
  default: jest.fn(),
}));

jest.unstable_mockModule('../../config/openrouter.js', () => ({
  getConfig: jest.fn(),
  getOcrConfig: jest.fn(),
  isAvailable: jest.fn(() => true),
}));

const pdfParseModule = await import('pdf-parse/lib/pdf-parse.js');
const openrouterModule = await import('../../config/openrouter.js');

const { pool } = await import('../../config/database.js');
const ocrJobModel = await import('../../models/ocrJobModel.js');
const menuItemModel = await import('../../models/menuItemModel.js');
const ocrService = await import('../../services/ocr/ocrService.js');
const ocrJobPoller = await import('../../services/ocr/ocrJobPoller.js');
const { createPartnerAndGetToken, createTestEstablishment } = await import('../utils/auth.js');

const OCR_CONFIG = {
  apiKey: 'test-key',
  baseUrl: 'https://test.openrouter.ai/api/v1',
  model: 'test-model',
};

/**
 * Insert a minimal establishment_media row with file_type='pdf'.
 * Does not call real mediaService/cloudinary — we feed a fake URL and trust the
 * mocked pdf-parse + fetch chain.
 */
const insertTestMedia = async (establishmentId, fileType = 'pdf') => {
  const mediaId = randomUUID();
  const url = `https://res.cloudinary.com/test/image/upload/v1/establishments/${establishmentId}/menu_pdf/test.pdf`;
  await pool.query(
    `INSERT INTO establishment_media (
       id, establishment_id, type, file_type, url, thumbnail_url, preview_url, position, is_primary
     ) VALUES ($1, $2, 'menu', $3, $4, $4, $4, 0, false)`,
    [mediaId, establishmentId, fileType, url],
  );
  return { mediaId, url };
};

/**
 * Build a fetch mock that returns a PDF buffer for pdf-downloads and a JSON
 * chat-completion response for the structurer call. Switches based on URL.
 */
const buildFetchMock = (structuredItems) => {
  return jest.fn(async (url) => {
    if (url.includes('/chat/completions')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({ items: structuredItems }),
              },
            },
          ],
        }),
        text: async () => '',
      };
    }

    // Default: PDF download
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(64),
    };
  });
};

describe('JOB_DURATION_BOUND_MS', () => {
  // server.js measures the graceful-shutdown budget against this sum; a renamed
  // summand would make it NaN, which never trips a comparison — pin it here,
  // where the real module (not a mock) is imported.
  test('is the finite sum of the three stage timeouts: PDF download + vision + structurer = 180 s', () => {
    expect(ocrService.JOB_DURATION_BOUND_MS).toBe(60000 + 60000 + 60000);
  });
});

describe('OCR pipeline integration', () => {
  let establishment;
  let originalFetch;

  beforeAll(async () => {
    const { partner } = await createPartnerAndGetToken();
    establishment = await createTestEstablishment(partner.id);
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM menu_items WHERE establishment_id = $1', [establishment.id]);
    await pool.query('DELETE FROM ocr_jobs WHERE establishment_id = $1', [establishment.id]);
    await pool.query('DELETE FROM establishment_media WHERE establishment_id = $1', [establishment.id]);
    await pool.query('DELETE FROM notifications WHERE user_id = $1', [establishment.partner_id]);
    originalFetch = global.fetch;
    openrouterModule.getOcrConfig.mockReturnValue(OCR_CONFIG);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await pool.query('DELETE FROM menu_items WHERE establishment_id = $1', [establishment.id]);
    await pool.query('DELETE FROM ocr_jobs WHERE establishment_id = $1', [establishment.id]);
    await pool.query('DELETE FROM establishment_media WHERE establishment_id = $1', [establishment.id]);
    await pool.query('DELETE FROM notifications WHERE user_id = $1', [establishment.partner_id]);
  });

  /** menu_parsed rows of the partner, oldest first. */
  const partnerNotifications = async () => {
    const result = await pool.query(
      `SELECT message FROM notifications
       WHERE user_id = $1 AND type = 'menu_parsed'
       ORDER BY created_at ASC`,
      [establishment.partner_id],
    );
    return result.rows;
  };

  /**
   * processJob notifies fire-and-forget after it has returned — poll the table
   * until the expected count shows up instead of sleeping a fixed time.
   */
  const waitForNotifications = async (expectedCount, timeoutMs = 3000) => {
    const deadline = Date.now() + timeoutMs;
    let rows = await partnerNotifications();
    while (rows.length < expectedCount && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      rows = await partnerNotifications();
    }
    return rows;
  };

  /** Grace period for a negative assertion ("nothing was sent"). */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

  /** fetch mock where both the PDF download and the structurer call fail. */
  const failingFetch = () => jest.fn(async () => ({
    ok: false,
    status: 500,
    text: async () => 'fail',
    arrayBuffer: async () => new ArrayBuffer(64),
  }));

  test('end-to-end: pdf with text layer → structured items persisted, job marked done', async () => {
    const { mediaId } = await insertTestMedia(establishment.id, 'pdf');

    // pdf-parse returns a realistic menu text → hasTextLayer=true
    const menuText =
      'Борщ украинский — 15 руб.\nСалат Цезарь — 12 руб.\n' +
      'Пицца Маргарита — 18 руб.\nКофе эспрессо — 4 руб.\n' +
      'Вода минеральная — 3 руб.';
    pdfParseModule.default.mockResolvedValue({
      text: menuText,
      numpages: 1,
    });

    // Structurer returns 5 items, one flagged-price (0.1), one low-confidence (0.5)
    const structuredItems = [
      { item_name: 'Борщ украинский', price_byn: 15, category_raw: 'Супы', confidence: 0.95 },
      { item_name: 'Салат Цезарь', price_byn: 12, category_raw: 'Салаты', confidence: 0.9 },
      { item_name: 'Пицца Маргарита', price_byn: 18, category_raw: 'Пицца', confidence: 0.88 },
      { item_name: 'Cheap item', price_byn: 0.1, category_raw: null, confidence: 0.9 },
      { item_name: 'Uncertain', price_byn: 20, category_raw: null, confidence: 0.5 },
    ];
    global.fetch = buildFetchMock(structuredItems);

    // Enqueue and atomically pick
    await ocrJobModel.enqueue({ establishmentId: establishment.id, mediaId });
    const picked = await ocrJobModel.pickNextPending();
    expect(picked).not.toBeNull();
    expect(picked.status).toBe('processing');
    expect(picked.attempts).toBe(1);

    // Run orchestrator
    const result = await ocrService.processJob(picked.id);
    expect(result.success).toBe(true);
    expect(result.itemCount).toBe(5);

    // Job marked done with result_summary
    const finalJob = await ocrJobModel.getJobStatus(picked.id);
    expect(finalJob.status).toBe('done');
    expect(finalJob.completed_at).not.toBeNull();
    expect(finalJob.error_message).toBeNull();
    expect(finalJob.result_summary).toMatchObject({
      strategy: 'pdf_text_layer',
      items_count: 5,
      flagged_count: 2,
    });

    // Menu items persisted with sanity flags applied
    const persistedItems = await menuItemModel.getByEstablishmentId(establishment.id, {
      includeHidden: true,
    });
    expect(persistedItems).toHaveLength(5);

    const byName = Object.fromEntries(persistedItems.map((it) => [it.item_name, it]));
    expect(byName['Борщ украинский'].sanity_flag).toBeNull();
    expect(byName['Cheap item'].sanity_flag).toMatchObject({
      reason: 'price_below_threshold',
    });
    expect(byName['Uncertain'].sanity_flag).toMatchObject({
      reason: 'low_confidence',
    });

    // Numeric types come back from pg as strings for DECIMAL — verify value
    expect(Number(byName['Борщ украинский'].price_byn)).toBe(15);
  });

  test('pdf-parse returns scanned PDF (no text layer) → vision fallback path', async () => {
    const { mediaId } = await insertTestMedia(establishment.id, 'pdf');

    // pdf-parse returns short garbage text → hasTextLayer=false
    pdfParseModule.default.mockResolvedValue({
      text: 'xy',
      numpages: 2,
    });

    const structuredItems = [
      { item_name: 'Scanned Dish', price_byn: 10, category_raw: null, confidence: 0.85 },
    ];

    // Two OpenRouter calls happen: vision extract + structurer. For this test we
    // return the same mock for both — vision gets "raw text", structurer gets items.
    let chatCallCount = 0;
    global.fetch = jest.fn(async (url) => {
      if (url.includes('/chat/completions')) {
        chatCallCount++;
        if (chatCallCount === 1) {
          // Vision call — return raw text
          return {
            ok: true,
            status: 200,
            json: async () => ({
              choices: [{ message: { content: 'Scanned Dish — 10 руб' } }],
            }),
            text: async () => '',
          };
        }
        // Structurer call
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              { message: { content: JSON.stringify({ items: structuredItems }) } },
            ],
          }),
          text: async () => '',
        };
      }
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(64) };
    });

    await ocrJobModel.enqueue({ establishmentId: establishment.id, mediaId });
    const picked = await ocrJobModel.pickNextPending();
    const result = await ocrService.processJob(picked.id);

    expect(result.success).toBe(true);
    const finalJob = await ocrJobModel.getJobStatus(picked.id);
    expect(finalJob.status).toBe('done');
    expect(finalJob.result_summary.strategy).toBe('vision_pdf_fallback');
    expect(chatCallCount).toBe(2);
  });

  test('menu photo (file_type=image) → vision_image strategy, items persisted', async () => {
    const { mediaId } = await insertTestMedia(establishment.id, 'image');

    const structuredItems = [
      { item_name: 'Фото-блюдо', price_byn: 9, category_raw: null, confidence: 0.9 },
    ];

    // Two OpenRouter calls: vision extract (photo URL directly, no pg_N pages),
    // then structurer.
    let chatCallCount = 0;
    global.fetch = jest.fn(async (url) => {
      if (url.includes('/chat/completions')) {
        chatCallCount++;
        if (chatCallCount === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              choices: [{ message: { content: 'Фото-блюдо — 9 руб' } }],
            }),
            text: async () => '',
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              { message: { content: JSON.stringify({ items: structuredItems }) } },
            ],
          }),
          text: async () => '',
        };
      }
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(64) };
    });

    await ocrJobModel.enqueue({ establishmentId: establishment.id, mediaId });
    const picked = await ocrJobModel.pickNextPending();
    const result = await ocrService.processJob(picked.id);

    expect(result.success).toBe(true);
    expect(result.itemCount).toBe(1);

    const finalJob = await ocrJobModel.getJobStatus(picked.id);
    expect(finalJob.status).toBe('done');
    expect(finalJob.result_summary.strategy).toBe('vision_image');
    expect(chatCallCount).toBe(2);
    // Photos never touch the pdf-parse path.
    expect(pdfParseModule.default).not.toHaveBeenCalled();

    const persistedItems = await menuItemModel.getByEstablishmentId(establishment.id, {
      includeHidden: true,
    });
    expect(persistedItems).toHaveLength(1);
    expect(persistedItems[0].item_name).toBe('Фото-блюдо');
    expect(persistedItems[0].media_id).toBe(mediaId);
  });

  test('structurer throws → markFailed returns job to pending (retry)', async () => {
    const { mediaId } = await insertTestMedia(establishment.id, 'pdf');

    pdfParseModule.default.mockResolvedValue({
      text: 'Борщ 15 руб.\nСалат 12 руб.\nПицца 18 руб.\nКофе 4 руб.',
      numpages: 1,
    });

    // 500 error from structurer
    global.fetch = jest.fn(async (url) => {
      if (url.includes('/chat/completions')) {
        return { ok: false, status: 500, text: async () => 'upstream failure' };
      }
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(64) };
    });

    await ocrJobModel.enqueue({ establishmentId: establishment.id, mediaId });
    const picked = await ocrJobModel.pickNextPending();

    const result = await ocrService.processJob(picked.id);
    expect(result.success).toBe(false);

    const afterFail = await ocrJobModel.getJobStatus(picked.id);
    expect(afterFail.status).toBe('pending'); // attempts=1 < max_attempts=3 → retry
    expect(afterFail.attempts).toBe(1);
    expect(afterFail.error_message).toMatch(/500/);
    expect(afterFail.completed_at).toBeNull();
  });

  test('permanent failure: after max_attempts reached, job becomes failed', async () => {
    const { mediaId } = await insertTestMedia(establishment.id, 'pdf');

    pdfParseModule.default.mockRejectedValue(new Error('parse error'));
    // vision also fails
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => 'fail',
      arrayBuffer: async () => new ArrayBuffer(64),
    }));

    // Force attempts to 3 so that the next processJob call drives to permanent failure
    const job = await ocrJobModel.enqueue({ establishmentId: establishment.id, mediaId });
    await pool.query(
      'UPDATE ocr_jobs SET attempts = 3 WHERE id = $1',
      [job.id],
    );

    const picked = await ocrJobModel.pickNextPending();
    expect(picked.attempts).toBe(4); // incremented from 3

    await ocrService.processJob(picked.id);

    const final = await ocrJobModel.getJobStatus(picked.id);
    expect(final.status).toBe('failed');
    expect(final.completed_at).not.toBeNull();
  });

  test('enqueue idempotency: second enqueue returns the active job', async () => {
    const { mediaId } = await insertTestMedia(establishment.id, 'pdf');

    const first = await ocrJobModel.enqueue({ establishmentId: establishment.id, mediaId });
    const second = await ocrJobModel.enqueue({ establishmentId: establishment.id, mediaId });

    expect(second.id).toBe(first.id);

    const rows = await pool.query(
      'SELECT COUNT(*) as count FROM ocr_jobs WHERE media_id = $1',
      [mediaId],
    );
    expect(parseInt(rows.rows[0].count, 10)).toBe(1);
  });

  test('replaceForMedia: previous items fully replaced, delta detected for price change', async () => {
    const { mediaId } = await insertTestMedia(establishment.id, 'pdf');

    // Pre-seed menu_items with an item that will appear again with a spiked price
    await menuItemModel.createMany({
      establishmentId: establishment.id,
      mediaId,
      items: [
        { item_name: 'Борщ', price_byn: 10, confidence: 0.9, position: 0 },
        { item_name: 'Old item removed', price_byn: 5, confidence: 0.9, position: 1 },
      ],
    });

    pdfParseModule.default.mockResolvedValue({
      text: 'Борщ 50 руб\nСалат 12 руб\nПицца 18 руб\nКофе 4 руб',
      numpages: 1,
    });

    global.fetch = buildFetchMock([
      { item_name: 'Борщ', price_byn: 50, category_raw: null, confidence: 0.95 },
      { item_name: 'Салат', price_byn: 12, category_raw: null, confidence: 0.9 },
    ]);

    await ocrJobModel.enqueue({ establishmentId: establishment.id, mediaId });
    const picked = await ocrJobModel.pickNextPending();
    await ocrService.processJob(picked.id);

    const items = await menuItemModel.getByEstablishmentId(establishment.id, {
      includeHidden: true,
    });
    expect(items).toHaveLength(2);
    const borshch = items.find((it) => it.item_name === 'Борщ');
    expect(borshch.sanity_flag).toMatchObject({
      reason: 'price_delta_anomaly',
      details: expect.objectContaining({
        previousPrice: 10,
        currentPrice: 50,
      }),
    });
    expect(items.find((it) => it.item_name === 'Old item removed')).toBeUndefined();
  });

  // ── Batch-level partner notification ─────────────────────────────────────
  // Coordinator decision 2026-09-04, option «б»: a job is one file, the
  // partner uploads a menu — notify once, when the last active job settles,
  // with totals over the whole menu. Before this, every job produced its own
  // in-app row and push.

  describe('menu_parsed notification — once per upload batch', () => {
    const menuText =
      'Борщ украинский — 15 руб.\nСалат Цезарь — 12 руб.\n' +
      'Пицца Маргарита — 18 руб.\nКофе эспрессо — 4 руб.\n' +
      'Вода минеральная — 3 руб.';

    const fiveItems = [
      { item_name: 'Борщ украинский', price_byn: 15, category_raw: 'Супы', confidence: 0.95 },
      { item_name: 'Салат Цезарь', price_byn: 12, category_raw: 'Салаты', confidence: 0.9 },
      { item_name: 'Пицца Маргарита', price_byn: 18, category_raw: 'Пицца', confidence: 0.88 },
      { item_name: 'Кофе эспрессо', price_byn: 4, category_raw: 'Напитки', confidence: 0.9 },
      { item_name: 'Вода минеральная', price_byn: 3, category_raw: 'Напитки', confidence: 0.9 },
    ];

    const threeItems = [
      { item_name: 'Тирамису', price_byn: 9, category_raw: 'Десерты', confidence: 0.9 },
      { item_name: 'Чизкейк', price_byn: 8, category_raw: 'Десерты', confidence: 0.9 },
      { item_name: 'Чай', price_byn: 3, category_raw: 'Напитки', confidence: 0.9 },
    ];

    /** Pick the oldest pending job and run it with the given structurer output. */
    const runNextJobWith = async (items) => {
      pdfParseModule.default.mockResolvedValue({ text: menuText, numpages: 1 });
      global.fetch = buildFetchMock(items);
      const picked = await ocrJobModel.pickNextPending();
      expect(picked).not.toBeNull();
      const result = await ocrService.processJob(picked.id);
      expect(result.success).toBe(true);
      return picked;
    };

    test('single file → one notification with the per-file wording', async () => {
      const { mediaId } = await insertTestMedia(establishment.id, 'pdf');
      await ocrJobModel.enqueue({ establishmentId: establishment.id, mediaId });

      await runNextJobWith(fiveItems);

      // processJob awaits the notification (graceful-shutdown safety): the row
      // must exist the moment processJob resolves — no polling here on purpose.
      const rows = await partnerNotifications();
      expect(rows).toHaveLength(1);
      expect(rows[0].message).toBe('Меню «Test Restaurant» распознано — 5 позиций');
    });

    test('a zombie processing job (older than STALE_PROCESSING_INTERVAL) does not hold the batch open', async () => {
      // Process died mid-job hours ago: the row stays 'processing' and nothing will settle it.
      const zombie = await insertTestMedia(establishment.id, 'pdf');
      await pool.query(
        `INSERT INTO ocr_jobs (establishment_id, media_id, status, attempts, created_at, started_at)
         VALUES ($1, $2, 'processing', 1, NOW() - INTERVAL '2 hours', NOW() - INTERVAL '2 hours')`,
        [establishment.id, zombie.mediaId],
      );

      const { mediaId } = await insertTestMedia(establishment.id, 'pdf');
      await ocrJobModel.enqueue({ establishmentId: establishment.id, mediaId });
      await runNextJobWith(fiveItems);

      const rows = await partnerNotifications();
      expect(rows).toHaveLength(1);
      expect(rows[0].message).toBe('Меню «Test Restaurant» распознано — 5 позиций');
    });

    test('a fresh processing sibling does hold the batch open', async () => {
      const sibling = await insertTestMedia(establishment.id, 'pdf');
      await pool.query(
        `INSERT INTO ocr_jobs (establishment_id, media_id, status, attempts, started_at)
         VALUES ($1, $2, 'processing', 1, NOW())`,
        [establishment.id, sibling.mediaId],
      );

      const { mediaId } = await insertTestMedia(establishment.id, 'pdf');
      await ocrJobModel.enqueue({ establishmentId: establishment.id, mediaId });
      await runNextJobWith(fiveItems);

      await settle();
      expect(await partnerNotifications()).toHaveLength(0);
    });

    test('two files queued together → silence after the first job, ONE aggregated notification after the last', async () => {
      const first = await insertTestMedia(establishment.id, 'pdf');
      const second = await insertTestMedia(establishment.id, 'pdf');

      // Both files are queued up front — that is what an upload of N files looks like.
      await ocrJobModel.enqueue({ establishmentId: establishment.id, mediaId: first.mediaId });
      await ocrJobModel.enqueue({ establishmentId: establishment.id, mediaId: second.mediaId });

      const firstJob = await runNextJobWith(fiveItems);
      expect(firstJob.media_id).toBe(first.mediaId);

      await settle();
      expect(await partnerNotifications()).toHaveLength(0);

      const secondJob = await runNextJobWith(threeItems);
      expect(secondJob.media_id).toBe(second.mediaId);

      const rows = await waitForNotifications(1);
      expect(rows).toHaveLength(1);
      expect(rows[0].message).toBe(
        'Меню «Test Restaurant» распознано — всего 8 позиций из 2 файлов',
      );

      // Nothing more arrives later either.
      await settle();
      expect(await partnerNotifications()).toHaveLength(1);
    });

    test('a retry (failure with attempts left) keeps the batch open; the retried job closes it', async () => {
      const good = await insertTestMedia(establishment.id, 'pdf');
      const flaky = await insertTestMedia(establishment.id, 'pdf');
      await ocrJobModel.enqueue({ establishmentId: establishment.id, mediaId: good.mediaId });
      const flakyJob = await ocrJobModel.enqueue({ establishmentId: establishment.id, mediaId: flaky.mediaId });

      await runNextJobWith(fiveItems);
      await settle();
      expect(await partnerNotifications()).toHaveLength(0);

      // First attempt of the second file fails → back to 'pending' → batch still open.
      pdfParseModule.default.mockRejectedValue(new Error('parse error'));
      global.fetch = failingFetch();
      const attempt = await ocrJobModel.pickNextPending();
      expect(attempt.id).toBe(flakyJob.id);
      expect((await ocrService.processJob(attempt.id)).success).toBe(false);
      expect((await ocrJobModel.getJobStatus(attempt.id)).status).toBe('pending');

      await settle();
      expect(await partnerNotifications()).toHaveLength(0);

      // The retry succeeds and is the last active job → one notification, full totals.
      const retried = await runNextJobWith(threeItems);
      expect(retried.id).toBe(flakyJob.id);

      const rows = await waitForNotifications(1);
      expect(rows).toHaveLength(1);
      expect(rows[0].message).toBe(
        'Меню «Test Restaurant» распознано — всего 8 позиций из 2 файлов',
      );
    });

    test('permanent failure of the last file still reports what the batch recognised', async () => {
      const good = await insertTestMedia(establishment.id, 'pdf');
      const bad = await insertTestMedia(establishment.id, 'pdf');
      await ocrJobModel.enqueue({ establishmentId: establishment.id, mediaId: good.mediaId });
      const badJob = await ocrJobModel.enqueue({ establishmentId: establishment.id, mediaId: bad.mediaId });
      // Last allowed attempt: the next pick drives it to permanent failure.
      await pool.query('UPDATE ocr_jobs SET attempts = 3 WHERE id = $1', [badJob.id]);

      const goodJob = await runNextJobWith(fiveItems);
      expect(goodJob.media_id).toBe(good.mediaId);

      await settle();
      expect(await partnerNotifications()).toHaveLength(0);

      pdfParseModule.default.mockRejectedValue(new Error('parse error'));
      global.fetch = failingFetch();
      const picked = await ocrJobModel.pickNextPending();
      expect(picked.id).toBe(badJob.id);
      expect((await ocrService.processJob(picked.id)).success).toBe(false);
      expect((await ocrJobModel.getJobStatus(picked.id)).status).toBe('failed');

      const rows = await waitForNotifications(1);
      expect(rows).toHaveLength(1);
      // Only the good file yielded items → single-file wording, failed file not mentioned.
      expect(rows[0].message).toBe('Меню «Test Restaurant» распознано — 5 позиций');
    });

    test('lone permanent failure with nothing recognised in its batch stays silent', async () => {
      // An older batch already produced items — must not be mistaken for this one.
      const old = await insertTestMedia(establishment.id, 'pdf');
      await menuItemModel.createMany({
        establishmentId: establishment.id,
        mediaId: old.mediaId,
        items: [{ item_name: 'Старая позиция', price_byn: 5, confidence: 0.9, position: 0 }],
      });
      await pool.query(
        `INSERT INTO ocr_jobs (establishment_id, media_id, status, attempts, created_at, completed_at)
         VALUES ($1, $2, 'done', 1, NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day')`,
        [establishment.id, old.mediaId],
      );

      const bad = await insertTestMedia(establishment.id, 'pdf');
      const badJob = await ocrJobModel.enqueue({ establishmentId: establishment.id, mediaId: bad.mediaId });
      await pool.query('UPDATE ocr_jobs SET attempts = 3 WHERE id = $1', [badJob.id]);

      pdfParseModule.default.mockRejectedValue(new Error('parse error'));
      global.fetch = failingFetch();
      const picked = await ocrJobModel.pickNextPending();
      expect(picked.id).toBe(badJob.id);
      expect((await ocrService.processJob(picked.id)).success).toBe(false);
      expect((await ocrJobModel.getJobStatus(picked.id)).status).toBe('failed');

      await settle();
      expect(await partnerNotifications()).toHaveLength(0);
    });
  });

  // ── Stale processing sweep (poller reaper) ───────────────────────────────
  // A 'processing' row whose process died mid-job is settled by nobody:
  // enqueue keeps returning it ("re-run OCR" is dead for that file) and the
  // admin health signals count it as in flight. ocrJobPoller.sweepStaleJobs
  // settles rows older than STALE_PROCESSING_INTERVAL under the markFailed
  // retry rule. The poller itself never starts under NODE_ENV=test — the
  // sweep is invoked directly, like processJob.

  describe('stale processing sweep — ocrJobPoller.sweepStaleJobs', () => {
    /**
     * A job whose process died `age` ago (PostgreSQL interval literal), with
     * the row left in 'processing'. Age is written by the database, like
     * pickNextPending does, so the comparison never crosses the driver.
     */
    const insertZombie = async ({ attempts, age, withStartedAt = true }) => {
      const { mediaId } = await insertTestMedia(establishment.id, 'pdf');
      const startedAtSql = withStartedAt ? 'NOW() - $4::interval' : 'NULL';
      const result = await pool.query(
        `INSERT INTO ocr_jobs (establishment_id, media_id, status, attempts, created_at, started_at)
         VALUES ($1, $2, 'processing', $3, NOW() - $4::interval, ${startedAtSql})
         RETURNING *`,
        [establishment.id, mediaId, attempts, age],
      );
      return result.rows[0];
    };

    /** A batch mate that finished 90 minutes ago and produced `items`. */
    const insertDoneMate = async (items) => {
      const mate = await insertTestMedia(establishment.id, 'pdf');
      await menuItemModel.createMany({
        establishmentId: establishment.id,
        mediaId: mate.mediaId,
        items,
      });
      await pool.query(
        `INSERT INTO ocr_jobs (establishment_id, media_id, status, attempts, created_at, completed_at)
         VALUES ($1, $2, 'done', 1, NOW() - INTERVAL '2 hours', NOW() - INTERVAL '90 minutes')`,
        [establishment.id, mate.mediaId],
      );
      return mate;
    };

    /** The sweep is global across the test DB — judge only rows of this establishment. */
    const ownReaped = (rows) => rows.filter((job) => job.establishment_id === establishment.id);

    test('older than STALE_PROCESSING_INTERVAL with attempts left → back to pending; re-run works again', async () => {
      const zombie = await insertZombie({ attempts: 1, age: '2 hours' });

      const reaped = ownReaped(await ocrJobPoller.sweepStaleJobs());
      expect(reaped.map((job) => job.id)).toEqual([zombie.id]);

      const after = await ocrJobModel.getJobStatus(zombie.id);
      expect(after.status).toBe('pending');
      expect(after.attempts).toBe(1);
      expect(after.error_message).toBe('stale processing reaped after 1 hour');
      expect(after.started_at).toBeNull();
      expect(after.completed_at).toBeNull();

      // Active again through the normal path: enqueue returns it (no duplicate)
      // and the poller picks it up for its second attempt.
      const again = await ocrJobModel.enqueue({ establishmentId: establishment.id, mediaId: zombie.media_id });
      expect(again.id).toBe(zombie.id);
      const picked = await ocrJobModel.pickNextPending();
      expect(picked.id).toBe(zombie.id);
      expect(picked.attempts).toBe(2);
      expect(picked.started_at).not.toBeNull();
    });

    test('older than the interval with no attempts left → failed with completed_at; the media can be queued anew', async () => {
      const zombie = await insertZombie({ attempts: 3, age: '2 hours' });

      const reaped = ownReaped(await ocrJobPoller.sweepStaleJobs());
      expect(reaped.map((job) => job.status)).toEqual(['failed']);

      const after = await ocrJobModel.getJobStatus(zombie.id);
      expect(after.status).toBe('failed');
      expect(after.attempts).toBe(3);
      expect(after.error_message).toBe('stale processing reaped after 1 hour');
      expect(after.completed_at).not.toBeNull();
      expect(after.started_at).not.toBeNull();

      // Before the sweep, enqueue would have returned the zombie forever.
      const fresh = await ocrJobModel.enqueue({ establishmentId: establishment.id, mediaId: zombie.media_id });
      expect(fresh.id).not.toBe(zombie.id);
      expect(fresh.status).toBe('pending');
      expect(fresh.attempts).toBe(0);
    });

    test('a fresh processing row is untouched', async () => {
      const inFlight = await insertZombie({ attempts: 1, age: '5 minutes' });

      const reaped = ownReaped(await ocrJobPoller.sweepStaleJobs());
      expect(reaped).toEqual([]);

      const after = await ocrJobModel.getJobStatus(inFlight.id);
      expect(after.status).toBe('processing');
      expect(after.attempts).toBe(1);
      expect(after.error_message).toBeNull();
      expect(after.started_at).not.toBeNull();
      expect(after.completed_at).toBeNull();
    });

    test('started_at NULL falls back to created_at for the age', async () => {
      const zombie = await insertZombie({ attempts: 1, age: '2 hours', withStartedAt: false });

      await ocrJobPoller.sweepStaleJobs();

      expect((await ocrJobModel.getJobStatus(zombie.id)).status).toBe('pending');
    });

    test('permanently failing the last job of a batch reports what its batch mates recognised', async () => {
      await insertDoneMate([
        { item_name: 'Борщ', price_byn: 15, confidence: 0.9, position: 0 },
        { item_name: 'Салат', price_byn: 12, confidence: 0.9, position: 1 },
      ]);
      const zombie = await insertZombie({ attempts: 3, age: '2 hours' });

      await ocrJobPoller.sweepStaleJobs();
      expect((await ocrJobModel.getJobStatus(zombie.id)).status).toBe('failed');

      // The sweep awaits the notification: the row exists the moment it resolves.
      const rows = await partnerNotifications();
      expect(rows).toHaveLength(1);
      expect(rows[0].message).toBe('Меню «Test Restaurant» распознано — 2 позиции');
    });

    test('a job reaped back to pending keeps the batch open — no notification', async () => {
      await insertDoneMate([
        { item_name: 'Борщ', price_byn: 15, confidence: 0.9, position: 0 },
      ]);
      const zombie = await insertZombie({ attempts: 1, age: '2 hours' });

      await ocrJobPoller.sweepStaleJobs();
      expect((await ocrJobModel.getJobStatus(zombie.id)).status).toBe('pending');

      await settle();
      expect(await partnerNotifications()).toHaveLength(0);
    });
  });
});
