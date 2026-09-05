/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: pdfTextExtractor.js
 *
 * Focus: hasUsableTextLayer heuristic — the decision gate that determines
 * whether the orchestrator uses pdf-parse output directly or falls back to
 * vision OCR. Testing this in isolation avoids real PDF I/O.
 *
 * Plus the download timeout: the PDF fetch is the one OCR stage with no
 * timeout of its own, so it must carry an AbortSignal that fires after
 * PDF_FETCH_TIMEOUT_MS — a stalled download must not outlive the
 * graceful-shutdown budget (config/shutdown.js). pdf-parse and the logger
 * are mocked; fetch is replaced per test.
 */

import { jest } from '@jest/globals';

const mockPdfParse = jest.fn();

jest.unstable_mockModule('pdf-parse/lib/pdf-parse.js', () => ({
  default: mockPdfParse,
}));

jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

const {
  extractText,
  hasUsableTextLayer,
  computePrintableRatio,
  MIN_AVG_CHARS_PER_PAGE,
  MIN_DIGIT_COUNT,
  MIN_PRINTABLE_RATIO,
  PDF_FETCH_TIMEOUT_MS,
} = await import('../../services/ocr/pdfTextExtractor.js');

describe('pdfTextExtractor heuristics', () => {
  describe('computePrintableRatio', () => {
    test('returns 0 for empty string', () => {
      expect(computePrintableRatio('')).toBe(0);
      expect(computePrintableRatio(null)).toBe(0);
    });

    test('returns 1.0 for plain ASCII text', () => {
      expect(computePrintableRatio('Hello World 123')).toBe(1.0);
    });

    test('returns 1.0 for Cyrillic text', () => {
      expect(computePrintableRatio('Борщ 15 руб')).toBe(1.0);
    });

    test('handles whitespace as printable', () => {
      expect(computePrintableRatio('abc\n\tdef')).toBe(1.0);
    });

    test('drops ratio when control chars dominate', () => {
      const garbage = '\x01\x02\x03\x04\x05\x06abc';
      const ratio = computePrintableRatio(garbage);
      expect(ratio).toBeCloseTo(3 / 9, 2);
    });
  });

  describe('hasUsableTextLayer', () => {
    test('rejects empty text', () => {
      expect(hasUsableTextLayer('', 5)).toBe(false);
    });

    test('rejects zero pages', () => {
      expect(hasUsableTextLayer('Some reasonable text content 123', 0)).toBe(false);
    });

    test('rejects text below min avg chars per page', () => {
      const short = 'Short';
      expect(hasUsableTextLayer(short, 1)).toBe(false);
    });

    test('rejects text with no digits', () => {
      const noDigits = 'A'.repeat(MIN_AVG_CHARS_PER_PAGE * 2);
      expect(hasUsableTextLayer(noDigits, 1)).toBe(false);
    });

    test('rejects text with garbage printable ratio', () => {
      const printable = 'Menu 1 2 3 ';
      const garbage = '\x01'.repeat(100);
      const mixed = printable + garbage;
      expect(hasUsableTextLayer(mixed, 1)).toBe(false);
    });

    test('accepts a valid menu page', () => {
      const realMenu =
        'Борщ украинский — 15 руб.\nСалат Цезарь — 12 руб.\n' +
        'Пицца Маргарита — 18 руб.\nКофе эспрессо — 4 руб.';
      expect(realMenu.length).toBeGreaterThan(MIN_AVG_CHARS_PER_PAGE);
      expect(hasUsableTextLayer(realMenu, 1)).toBe(true);
    });

    test('boundary: exactly at MIN_AVG_CHARS_PER_PAGE with digits passes', () => {
      const base = 'x'.repeat(MIN_AVG_CHARS_PER_PAGE);
      const withDigits = base + '1'.repeat(MIN_DIGIT_COUNT);
      expect(hasUsableTextLayer(withDigits, 1)).toBe(true);
    });

    test('boundary: just below MIN_DIGIT_COUNT fails', () => {
      const base = 'x'.repeat(MIN_AVG_CHARS_PER_PAGE);
      const tooFewDigits = base + '1'.repeat(MIN_DIGIT_COUNT - 1);
      expect(hasUsableTextLayer(tooFewDigits, 1)).toBe(false);
    });

    test('multi-page PDF with avg per page below threshold fails', () => {
      // 100 chars across 10 pages = 10 chars/page, below threshold
      const text = 'abc 123 xyz'.repeat(10);
      expect(hasUsableTextLayer(text, 10)).toBe(false);
    });

    test('constants are exported and finite', () => {
      expect(MIN_AVG_CHARS_PER_PAGE).toBeGreaterThan(0);
      expect(MIN_DIGIT_COUNT).toBeGreaterThan(0);
      expect(MIN_PRINTABLE_RATIO).toBeGreaterThan(0);
      expect(MIN_PRINTABLE_RATIO).toBeLessThanOrEqual(1);
    });
  });
});

describe('extractText — download timeout', () => {
  const PDF_URL = 'https://res.cloudinary.com/test/image/upload/v1/establishments/x/menu_pdf/menu.pdf';
  const PDF_TEXT = 'Борщ украинский — 15 руб.\nСалат Цезарь — 12 руб.\nПицца Маргарита — 18 руб.\nКофе — 4 руб.';
  let originalFetch;

  const okResponse = () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    arrayBuffer: async () => new ArrayBuffer(8),
  });

  beforeEach(() => {
    originalFetch = global.fetch;
    // resetMocks wipes implementations before every test — re-arm the default.
    mockPdfParse.mockResolvedValue({ text: PDF_TEXT, numpages: 1 });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  test('the download carries an AbortSignal — without one, undici\'s 300 s defaults are the only bound', async () => {
    global.fetch = jest.fn(async () => okResponse());

    const result = await extractText(PDF_URL);

    expect(result).toMatchObject({ pageCount: 1, hasTextLayer: true, text: PDF_TEXT });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe(PDF_URL);
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.signal.aborted).toBe(false);
  });

  test('a download stalled past PDF_FETCH_TIMEOUT_MS is aborted and extractText rejects before parsing', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn((url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('This operation was aborted')));
    }));

    const pending = extractText(PDF_URL);
    const outcome = expect(pending).rejects.toThrow('This operation was aborted');

    jest.advanceTimersByTime(PDF_FETCH_TIMEOUT_MS - 1);
    expect(global.fetch.mock.calls[0][1].signal.aborted).toBe(false);
    jest.advanceTimersByTime(1);
    expect(global.fetch.mock.calls[0][1].signal.aborted).toBe(true);

    await outcome;
    expect(mockPdfParse).not.toHaveBeenCalled();
  });

  test('a completed download clears its timer', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn(async () => okResponse());

    await extractText(PDF_URL);

    expect(jest.getTimerCount()).toBe(0);
  });

  test('a non-2xx response still fails loudly', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 404, statusText: 'Not Found' }));

    await expect(extractText(PDF_URL)).rejects.toThrow('Failed to fetch PDF: 404 Not Found');
    expect(mockPdfParse).not.toHaveBeenCalled();
  });

  test('the timeout is 60 s — the same bound as the vision and structurer calls', () => {
    expect(PDF_FETCH_TIMEOUT_MS).toBe(60000);
  });
});
