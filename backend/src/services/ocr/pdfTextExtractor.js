/**
 * PDF Text Extractor
 *
 * Wraps pdf-parse for extracting text from PDFs that have a text layer.
 * When the heuristic indicates the PDF is image-only (scanned), the orchestrator
 * falls back to vision OCR via pg_N URL transformations on Cloudinary.
 *
 * Uses deep import (pdf-parse/lib/pdf-parse.js) to bypass the package's index.js
 * which attempts to read a debug test file on load — a known quirk of pdf-parse.
 */

import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import logger from '../../utils/logger.js';

/**
 * Heuristic thresholds for determining whether a PDF has a usable text layer.
 * Tuned for menu documents in Russian/Belarusian/English. Adjust if false negatives
 * become common (scanned PDFs misclassified as having text, or vice versa).
 */
const MIN_AVG_CHARS_PER_PAGE = 50;
const MIN_DIGIT_COUNT = 3;
const MIN_PRINTABLE_RATIO = 0.7;

/**
 * Abort the PDF download after this long. fetch() has no timeout of its own:
 * without a signal the download is bounded only by undici's defaults (300 s
 * to the headers, 300 s between body chunks) — the one OCR stage that could
 * outlive the graceful-shutdown budget (config/shutdown.js); the vision and
 * structurer calls already abort after their REQUEST_TIMEOUT_MS. A 60 MB menu
 * from Cloudinary downloads in seconds. A timeout surfaces as "This operation
 * was aborted" and the orchestrator falls back to vision OCR, as for any
 * download failure. Same pattern as visionOcrAdapter (controller + timer).
 */
const PDF_FETCH_TIMEOUT_MS = 60000;

/**
 * Fetch a PDF from a URL and return it as a Buffer.
 * Uses the global fetch (Node.js 18+), aborted after PDF_FETCH_TIMEOUT_MS —
 * the signal covers the body read (arrayBuffer) as well as the headers.
 *
 * @param {string} url - Cloudinary PDF URL
 * @returns {Promise<Buffer>}
 */
const fetchPdfBuffer = async (url) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PDF_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Failed to fetch PDF: ${response.status} ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } finally {
    clearTimeout(timeoutId);
  }
};

/**
 * Compute ratio of printable ASCII + common Cyrillic characters to total characters.
 * Helps filter out PDFs where text extraction returned garbage (encoding artifacts).
 *
 * @param {string} text
 * @returns {number} 0..1
 */
const computePrintableRatio = (text) => {
  if (!text || text.length === 0) return 0;

  let printable = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    const isAscii = code >= 0x20 && code <= 0x7e;
    const isCyrillic = code >= 0x0400 && code <= 0x04ff;
    const isWhitespace = ch === '\n' || ch === '\r' || ch === '\t';
    if (isAscii || isCyrillic || isWhitespace) {
      printable++;
    }
  }

  return printable / text.length;
};

/**
 * Apply heuristic to determine if the extracted text looks like a real text layer.
 *
 * @param {string} text
 * @param {number} pageCount
 * @returns {boolean}
 */
const hasUsableTextLayer = (text, pageCount) => {
  if (!text || pageCount === 0) return false;

  const avgCharsPerPage = text.length / pageCount;
  if (avgCharsPerPage < MIN_AVG_CHARS_PER_PAGE) return false;

  const digitCount = (text.match(/\d/g) || []).length;
  if (digitCount < MIN_DIGIT_COUNT) return false;

  const printableRatio = computePrintableRatio(text);
  if (printableRatio < MIN_PRINTABLE_RATIO) return false;

  return true;
};

/**
 * Extract text from a PDF URL. Returns the text, page count, and whether the text
 * layer is usable. Caller decides whether to proceed with text-based structuring
 * or fall back to vision OCR.
 *
 * Never throws on "no text layer" — that's an expected signal for scanned PDFs.
 * Only throws on fetch or parse failures.
 *
 * @param {string} pdfUrl - Cloudinary PDF URL
 * @returns {Promise<{ text: string, pageCount: number, hasTextLayer: boolean }>}
 */
export const extractText = async (pdfUrl) => {
  const buffer = await fetchPdfBuffer(pdfUrl);
  const parsed = await pdfParse(buffer);

  const text = parsed.text || '';
  const pageCount = parsed.numpages || 0;
  const hasTextLayer = hasUsableTextLayer(text, pageCount);

  logger.debug('PDF text extraction complete', {
    pdfUrl,
    pageCount,
    textLength: text.length,
    hasTextLayer,
  });

  return { text, pageCount, hasTextLayer };
};

export {
  MIN_AVG_CHARS_PER_PAGE,
  MIN_DIGIT_COUNT,
  MIN_PRINTABLE_RATIO,
  PDF_FETCH_TIMEOUT_MS,
  hasUsableTextLayer,
  computePrintableRatio,
};
