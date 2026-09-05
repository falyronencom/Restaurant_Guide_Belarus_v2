/**
 * LLM Structurer
 *
 * Converts raw OCR text (from pdfTextExtractor or visionOcrAdapter) into a
 * structured array of menu items using OpenRouter with strict JSON output.
 *
 * Validates the response with Zod, following the pattern from smartSearchService.js:40-49.
 */

import { z } from 'zod';
import logger from '../../utils/logger.js';
import { getOcrConfig } from '../../config/openrouter.js';

const STRUCTURER_SYSTEM_PROMPT = `You convert raw menu text into structured JSON.

Output ONLY a JSON object with this exact shape, no prose:
{
  "items": [
    {
      "item_name": string,           // exact dish/drink name from menu
      "price_byn": number | null,    // price in Belarusian rubles, null if not stated (e.g. "seasonal")
      "category_raw": string | null, // original section heading (e.g. "Горячие блюда", "Напитки"), null if none
      "confidence": number           // 0.00-1.00, how confident you are this is a real menu position
    }
  ]
}

Rules:
- item_name is required and must be the dish name, not a description
- price_byn must be a number (no currency symbol). If menu shows "15 руб" → 15. If "по сезону" or missing → null.
- category_raw preserves the original section header verbatim
- Skip lines that are not menu items (addresses, phone numbers, hours, promotional text)
- Do not invent items. If the text is gibberish, return {"items": []}`;

const REQUEST_TIMEOUT_MS = 60000;

const ItemSchema = z.object({
  item_name: z.string().min(1).max(255),
  price_byn: z.number().nullable(),
  category_raw: z.string().max(100).nullable(),
  confidence: z.number().min(0).max(1),
});

const ResponseSchema = z.object({
  items: z.array(ItemSchema),
});

/**
 * Structure raw menu text into validated items.
 *
 * @param {string} rawText - OCR output
 * @returns {Promise<Object[]>} Array of validated items (may be empty)
 * @throws {Error} on API error, malformed response, or validation failure
 */
export const structureMenu = async (rawText) => {
  if (!rawText || rawText.trim().length === 0) {
    logger.debug('structureMenu called with empty text — returning empty items');
    return [];
  }

  const config = getOcrConfig();
  if (!config.apiKey) {
    throw new Error('OPENROUTER_API_KEY not configured — cannot run LLM structurer');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: STRUCTURER_SYSTEM_PROMPT },
          { role: 'user', content: rawText },
        ],
        temperature: 0,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter structurer call failed: ${response.status} ${errorText.slice(0, 200)}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('LLM structurer returned empty content');
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (jsonError) {
      throw new Error(`LLM structurer returned invalid JSON: ${jsonError.message}`);
    }

    const validated = ResponseSchema.safeParse(parsed);
    if (!validated.success) {
      throw new Error(`LLM structurer response failed schema validation: ${validated.error.message}`);
    }

    logger.debug('LLM structuring complete', {
      rawTextLength: rawText.length,
      itemCount: validated.data.items.length,
      model: config.model,
    });

    return validated.data.items;
  } finally {
    clearTimeout(timeoutId);
  }
};

export { STRUCTURER_SYSTEM_PROMPT, ResponseSchema, ItemSchema, REQUEST_TIMEOUT_MS };
