/**
 * Smart Search Service
 *
 * AI-powered intent parsing for natural language restaurant search queries.
 * Uses OpenRouter API (Gemini 2.5 Flash-Lite, fallback DeepSeek V3) to parse
 * user intent, then delegates to existing searchService for SQL execution.
 *
 * Pipeline: parseIntent → validate (Zod) → buildFilters → searchByRadius/searchWithoutLocation
 * Fallback: raw query → existing ILIKE + SEARCH_SYNONYMS (transparent to user)
 */

import { z } from 'zod';
import crypto from 'crypto';
import { getConfig, isAvailable } from '../config/openrouter.js';
import { setWithExpiry } from '../config/redis.js';
import redisClient from '../config/redis.js';
import * as searchService from './searchService.js';
import logger from '../utils/logger.js';
// Canon shared with the write-path + DB CHECK (CAT-C-2.9). DB stores Cyrillic
// directly; these drive the AI prompt and Zod enum validation.
import { VALID_CATEGORIES, VALID_CUISINES } from '../constants/establishmentVocab.js';

/**
 * Zod schema for AI response validation.
 * Invalid responses trigger fallback to ILIKE search.
 *
 * `dish` (Segment B): specific dish/drink the user is looking for. Distinct
 * from `category` (establishment type). Empty string is coerced to null to
 * tolerate LLMs that return "" instead of null.
 */
const intentSchema = z.object({
  cuisine: z.array(z.enum(VALID_CUISINES)).nullable(),
  category: z.enum(VALID_CATEGORIES).nullable(),
  dish: z
    .string()
    .nullable()
    .transform((v) => (v == null || v.trim() === '' ? null : v.trim())),
  meal_type: z.string().nullable(),
  price_max: z.number().positive().nullable(),
  location: z.string().nullable(),
  sort: z.enum(['distance', 'rating', 'price_asc']).nullable(),
  tags: z.array(z.string()).nullable().transform(v => v ?? []),
  error: z.string().nullable(),
});

/** Cache TTL: 1 hour */
const CACHE_TTL_SECONDS = 3600;

/** OpenRouter API timeout (20s — cold model startup via OpenRouter can be 10-15s) */
const API_TIMEOUT_MS = 20000;

/**
 * System prompt for AI intent parsing.
 * Pre-built once at module load to avoid repeated string construction.
 */
const SYSTEM_PROMPT = [
  'Parse restaurant search query into JSON.',
  `Categories (establishment types): ${VALID_CATEGORIES.join(', ')}`,
  `Cuisines: ${VALID_CUISINES.join(', ')}`,
  '',
  'IMPORTANT — distinguish ESTABLISHMENT TYPE from DISH NAME:',
  '- "кофейня рядом" → category="Кофейня", dish=null (user wants a coffee shop)',
  '- "кофе рядом" → category=null, dish="кофе" (user wants coffee as a drink)',
  '- "пиццерия на Немиге" → category="Пиццерия", dish=null',
  '- "пицца до 15 рублей" → category=null, dish="пицца"',
  '- "бар с дешёвым виски" → category="Бар", dish="виски"',
  '- "кафе с завтраками" → category="Кафе", dish=null, meal_type="breakfast"',
  'If the query contains BOTH a type and a dish, fill both fields.',
  '',
  'Output JSON: {"category":"one or null","cuisine":["array or null"],"dish":"specific dish or null","meal_type":"breakfast/lunch/dinner/snack or null","price_max":number_or_null,"location":"city or null","sort":"distance/rating/price_asc or null","tags":["keywords"],"error":null}',
  'Use EXACT category/cuisine names from lists above. Respond with JSON only.',
].join('\n');

/**
 * Normalize query for cache key generation.
 * @param {string} query
 * @returns {string}
 */
function normalizeQuery(query) {
  return query.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Generate a hash for cache key.
 * @param {string} normalizedQuery
 * @returns {string}
 */
function generateQueryHash(normalizedQuery) {
  return crypto.createHash('sha256').update(normalizedQuery).digest('hex').slice(0, 32);
}

/**
 * Get cached intent from Redis.
 * @param {string} queryHash
 * @returns {Promise<object|null>}
 */
export async function getCachedIntent(queryHash) {
  try {
    if (!redisClient.isOpen) return null;
    const cached = await redisClient.get(`smartsearch:${queryHash}`);
    return cached ? JSON.parse(cached) : null;
  } catch (error) {
    logger.warn('Smart search cache read failed', { error: error.message });
    return null;
  }
}

/**
 * Cache parsed intent in Redis.
 * @param {string} queryHash
 * @param {object} intent
 * @param {number} ttl - TTL in seconds
 */
export async function cacheIntent(queryHash, intent, ttl = CACHE_TTL_SECONDS) {
  try {
    if (!redisClient.isOpen) return;
    await setWithExpiry(`smartsearch:${queryHash}`, JSON.stringify(intent), ttl);
  } catch (error) {
    logger.warn('Smart search cache write failed', { error: error.message });
  }
}

/**
 * Call OpenRouter API to parse user intent.
 *
 * @param {string} query - User's natural language search query
 * @returns {Promise<object|null>} Parsed intent or null on failure
 */
export async function parseIntent(query) {
  if (!isAvailable()) {
    logger.debug('OpenRouter not available, skipping AI parsing');
    return null;
  }

  const config = getConfig();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://restaurantguidev2-production.up.railway.app',
        'X-Title': 'Restaurant Guide Belarus',
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: query },
        ],
        temperature: 0.1,
        max_tokens: 300,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      logger.error('OpenRouter API error', {
        status: response.status,
        statusText: response.statusText,
      });
      return null;
    }

    const data = await response.json();
    let content = data.choices?.[0]?.message?.content;

    if (!content) {
      logger.warn('OpenRouter returned empty content');
      return null;
    }

    // Strip markdown code fences if model wraps JSON in ```json ... ```
    content = content.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

    // Extract JSON object if surrounded by extra text
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn('No JSON object found in AI response', { query, content: content.slice(0, 200) });
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    logger.debug('AI raw parsed response', { query, parsed });
    const validated = intentSchema.parse(parsed);

    logger.info('AI intent parsed successfully', {
      query,
      intent: validated,
      model: data.model || config.model,
    });

    return validated;
  } catch (error) {
    if (error.name === 'AbortError') {
      logger.warn('OpenRouter API timeout', { query, timeoutMs: API_TIMEOUT_MS });
    } else if (error instanceof z.ZodError) {
      logger.warn('AI response failed Zod validation', {
        query,
        errors: error.errors,
      });
    } else {
      logger.error('AI intent parsing failed', {
        query,
        error: error.message,
      });
    }
    return null;
  }
}

/**
 * Convert parsed AI intent into parameters for existing search functions.
 *
 * Политика слияния — «явное сильнее выведенного, по размерностям».
 * Явные фильтры пришли из видимых пользователю контролов экрана; догадки
 * разбора — из его же фразы. В одной размерности спор решает контрол: снятый
 * чип «$$» не должен переживать в выдаче потому, что фраза «недорого»
 * подставила ярус цены. Разные размерности складываются: бюджет блюда
 * («пицца за 20 рублей» → priceMaxByn, цена позиции меню) и ярус цены
 * заведения — разные величины, обе остаются в силе. /
 * Explicit filters come from visible controls, inferred ones from the phrase;
 * within one dimension the control wins, across dimensions both apply.
 *
 * @param {object} intent - Validated intent from parseIntent()
 * @param {{ latitude?: number, longitude?: number, city?: string }} context - User context
 * @param {object} explicitFilters - Фильтры экрана из тела запроса (уже разобраны
 *   utils/searchFilterParams.js; ключи с null отброшены). / Screen filters,
 *   already parsed, absent keys dropped.
 * @returns {object} Parameters compatible with searchByRadius/searchWithoutLocation
 */
export function buildSmartSearchFilters(intent, context = {}, explicitFilters = {}) {
  const filters = {};

  // Category — явные категории экрана заменяют выведенную из фразы
  if (explicitFilters.categories) {
    filters.categories = explicitFilters.categories;
  } else if (intent.category) {
    filters.categories = [intent.category];
  }

  // Cuisines — та же размерность, то же правило
  if (explicitFilters.cuisines) {
    filters.cuisines = explicitFilters.cuisines;
  } else if (intent.cuisine && intent.cuisine.length > 0) {
    filters.cuisines = intent.cuisine;
  }

  // Dish (Segment B): routes the query to the menu_items EXISTS in searchService
  // (item name OR menu section). Without a stated budget the dish term also
  // rides as an OR-alternative at establishment level (ILIKE + SEARCH_SYNONYMS
  // via `dishOrSearch`): a pizzeria whose menu is not parsed yet still surfaces
  // for «пицца», and for the same word — absent other intent filters
  // (category/cuisine/location/city still AND-narrow) — the smart path never
  // finds less than the classic ?search= path. With a budget (price_max) the
  // match must be menu-verified — the user asked for a price we can only read
  // from a menu.
  if (intent.dish) {
    filters.dish = intent.dish;
    if (intent.price_max == null) {
      filters.dishOrSearch = intent.dish;
    }
  }

  // Price mapping:
  //  - If dish is present, price_max is a literal BYN ceiling on menu_items.price_byn
  //    (routed through searchService as `priceMaxByn`). price_range is NOT applied,
  //    because the user stated an actual money budget for a specific dish.
  //  - If no dish, fall back to the legacy subjective tier mapping to price_range.
  //  - Явный ярус с экрана заменяет ярусную подстановку, но НЕ отменяет
  //    priceMaxByn: «пицца за 20 рублей» с включённой карточкой «$$» — это
  //    позиция дешевле 20 BYN в заведении класса «$$». / An explicit tier
  //    replaces the inferred tier but coexists with a dish budget.
  if (intent.price_max != null) {
    if (intent.dish) {
      filters.priceMaxByn = intent.price_max;
    } else if (!explicitFilters.priceRange) {
      if (intent.price_max <= 15) {
        filters.priceRange = ['$'];
      } else if (intent.price_max <= 30) {
        filters.priceRange = ['$', '$$'];
      } else {
        filters.priceRange = ['$', '$$', '$$$'];
      }
    }
  }

  if (explicitFilters.priceRange) {
    filters.priceRange = explicitFilters.priceRange;
  }

  // Sort — выбранная пользователем сортировка сильнее и догадки, и умолчания
  if (explicitFilters.sortBy) {
    filters.sortBy = explicitFilters.sortBy;
  } else if (intent.sort) {
    filters.sortBy = intent.sort;
  } else {
    filters.sortBy = (context.latitude && context.longitude) ? 'distance' : 'rating';
  }

  // Location from AI (city override)
  if (intent.location) {
    filters.city = intent.location;
  } else if (context.city) {
    filters.city = context.city;
  }

  // Tags → search text for existing ILIKE + SEARCH_SYNONYMS — only without a
  // dish. The parser restates the dish word in tags ("пицца" → dish="пицца",
  // tags=["пицца"]); as an establishment-level filter AND-ed with the menu
  // match it returned zero rows for every dish outside SEARCH_SYNONYMS
  // («капучино») — prod, 07.09.2026. With a dish, tags are dropped rather than
  // AND-ed — accepting the loss of the rare non-dish tag («терраса») instead of
  // keeping a filter that zeroes the common case; joined multi-tag patterns
  // («пицца терраса») matched nothing anyway.
  if (!intent.dish && intent.tags && intent.tags.length > 0) {
    filters.search = intent.tags.join(' ');
  }

  // meal_type — logged for future use, not applied as filter
  if (intent.meal_type) {
    logger.debug('meal_type detected but not applied (Phase 1)', {
      mealType: intent.meal_type,
    });
  }

  // Размерности, которых разбор фразы не касается вовсе, — прямой проброс.
  // Спорить не с чем: у intent нет ни часов работы, ни удобств, ни рейтинга,
  // ни расстояния. / Dimensions the intent parser never produces: passed
  // straight through, nothing to arbitrate.
  for (const key of ['hoursFilter', 'features', 'minRating', 'maxDistance', 'radius']) {
    if (explicitFilters[key] != null) {
      filters[key] = explicitFilters[key];
    }
  }

  // Coordinates passthrough
  if (context.latitude && context.longitude) {
    filters.latitude = context.latitude;
    filters.longitude = context.longitude;
  }

  return filters;
}

/**
 * Execute smart search: AI parse → build filters → existing search pipeline.
 *
 * @param {string} query - Natural language query
 * @param {{ latitude?: number, longitude?: number, city?: string }} context
 * @param {{ limit?: number, page?: number }} pagination
 * @param {object} explicitFilters - Фильтры экрана (см. buildSmartSearchFilters).
 *   Применяются и на ветке fallback: при отказе AI экран результатов обязан
 *   получить свою классическую выдачу С фильтрами, иначе отключение AI молча
 *   расширяет выдачу вместо того, чтобы её сузить. / Applied on the fallback
 *   branch too — otherwise an AI outage silently drops the screen's filters.
 * @returns {Promise<{ intent: object|null, results: object[], pagination: object, fallback: boolean }>}
 */
export async function executeSmartSearch(query, context = {}, pagination = {}, explicitFilters = {}) {
  const { limit = 20, page = 1 } = pagination;
  const offset = (page - 1) * limit;

  const normalized = normalizeQuery(query);
  const queryHash = generateQueryHash(normalized);

  // 1. Check Redis cache
  let intent = await getCachedIntent(queryHash);
  let fromCache = false;

  if (intent) {
    fromCache = true;
    logger.debug('Smart search cache hit', { queryHash });
  } else {
    // 2. Call AI
    intent = await parseIntent(query);

    // 3. Cache on success
    if (intent) {
      await cacheIntent(queryHash, intent);
    }
  }

  // 4. Build filters or fallback
  const isFallback = !intent;

  let searchResult;

  if (intent) {
    // AI-parsed path
    const filters = buildSmartSearchFilters(intent, context, explicitFilters);

    const searchParams = {
      ...filters,
      limit,
      offset,
      page,
    };

    if (filters.latitude && filters.longitude) {
      searchResult = await searchService.searchByRadius(searchParams);
    } else {
      searchResult = await searchService.searchWithoutLocation(searchParams);
    }
  } else {
    // Fallback: raw query through existing ILIKE + SEARCH_SYNONYMS.
    // Фильтры экрана идут и здесь — иначе экран результатов при недоступном AI
    // показал бы выдачу шире выбранных фильтров.
    const fallbackParams = {
      ...explicitFilters,
      search: query,
      city: context.city || null,
      sortBy: explicitFilters.sortBy
        || ((context.latitude && context.longitude) ? 'distance' : 'rating'),
      limit,
      offset,
      page,
    };

    if (context.latitude && context.longitude) {
      fallbackParams.latitude = context.latitude;
      fallbackParams.longitude = context.longitude;
      searchResult = await searchService.searchByRadius(fallbackParams);
    } else {
      searchResult = await searchService.searchWithoutLocation(fallbackParams);
    }
  }

  // Log for analytics
  logSearchQuery(
    query,
    intent,
    searchResult.pagination?.total || 0,
    isFallback,
    fromCache,
    Object.keys(explicitFilters).length > 0,
  );

  return {
    intent: intent || null,
    results: searchResult.establishments || [],
    pagination: searchResult.pagination || { total: 0, page, limit, totalPages: 0 },
    fallback: isFallback,
  };
}

/**
 * Log search query for analytics (structured logger, no migration needed).
 *
 * `explicitFilters` — только ФАКТ наличия фильтров экрана, без значений:
 * значения ничего не добавляют к разбору стоимости запроса, а строка лога и
 * так несёт свободный текст пользователя. / Only whether screen filters were
 * present, never which ones.
 */
function logSearchQuery(rawQuery, parsedIntent, resultCount, isFallback, fromCache, hasExplicitFilters = false) {
  logger.info('smart_search_query', {
    query: rawQuery,
    intent: parsedIntent,
    resultCount,
    fallback: isFallback,
    fromCache,
    explicitFilters: hasExplicitFilters,
    timestamp: new Date().toISOString(),
  });
}
