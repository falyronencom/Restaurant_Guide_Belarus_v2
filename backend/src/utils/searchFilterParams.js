/**
 * Search Filter Parameters
 *
 * Единый разбор фильтров выдачи для обоих поисковых эндпоинтов /
 * one parser for the filter dimensions both search endpoints accept.
 *
 * Классический `GET /search/establishments` читает их из query-строки, умный
 * `POST /search/smart` — из тела запроса. Правила разбора и тексты ошибок
 * обязаны совпадать: расхождение здесь означает, что один и тот же экран
 * mobile получает разную выдачу в зависимости от того, пуста ли строка
 * поиска. / Identical parsing rules keep one screen's filters behaving the
 * same on both paths — the screen chooses the endpoint by whether its text
 * field is empty.
 *
 * Пагинация и координаты сюда НЕ входят намеренно: у эндпоинтов они разные
 * (классика знает `offset`, умный отвечает 400 на плохие координаты). /
 * Pagination and coordinates stay with each controller — they genuinely differ.
 */

import { AppError } from '../middleware/errorHandler.js';

/** Допустимые значения hours_filter / accepted hours_filter values */
const VALID_HOURS_FILTERS = ['until_22', 'until_morning', '24_hours'];

/**
 * Список значений: массив (JSON-массив или повторённый query-параметр) либо
 * строка через запятую. Пустой результат — `null`, а не пустой массив.
 *
 * Разница видна на `priceRange`: в `searchService` он проверяется голым
 * `if (priceRange)`, и пустой массив (истинный в JS) уходит в SQL как
 * `= ANY('{}')` — ноль строк на ровном месте. У `categories`, `cuisines` и
 * `features` проверки вида `&& length > 0`, там пустой массив безвреден;
 * общее правило держим ради `priceRange` и ради единообразия. / Only
 * `priceRange` is guarded by a bare truthiness check downstream, so an empty
 * array there zeroes the result set; the rule is uniform for consistency.
 *
 * @param {*} value
 * @returns {string[]|null}
 */
function parseList(value) {
  if (value == null || value === '') return null;
  const items = (Array.isArray(value) ? value : String(value).split(','))
    .map(v => String(v).trim())
    .filter(Boolean);
  return items.length > 0 ? items : null;
}

/**
 * Разобрать фильтры выдачи из query-строки или тела запроса.
 *
 * @param {object} source - `req.query` (классика) или `req.body` (умный поиск)
 * @returns {{
 *   categories: string[]|null, cuisines: string[]|null, priceRange: string[]|null,
 *   minRating: number|null, maxDistance: number|null, radius: number|null,
 *   sortBy: string|null, hoursFilter: string|null, features: string[]|null
 * }} Отсутствующее значение — `null`; умолчание подставляет `searchService`.
 *   `maxDistance` — в километрах (на вход приходят метры).
 * @throws {AppError} 422 VALIDATION_ERROR — тексты те же, что были в
 *   `searchController`: существующие тесты сторожат их дословно.
 */
export function parseSearchFilterParams(source = {}) {
  const {
    radius,
    max_distance,
    categories,
    cuisines,
    priceRange,
    minRating,
    min_rating,
    sort_by,
    hours_filter,
    features,
  } = source;

  // Радиус в километрах. Диапазон (0 < r <= 1000) проверяет searchByRadius —
  // здесь только разбор, ровно как было в классическом контроллере.
  let radiusKm = null;
  if (radius != null && radius !== '') {
    radiusKm = parseFloat(radius);
    if (isNaN(radiusKm)) {
      throw new AppError('Invalid radius', 422, 'VALIDATION_ERROR');
    }
  }

  // max_distance приходит в метрах, дальше по конвейеру — километры.
  // Невалидное или <= 0 — не ошибка: фильтр расстояния просто не применяется.
  let maxDistanceKm = null;
  if (max_distance != null && max_distance !== '') {
    const meters = parseFloat(max_distance);
    if (!isNaN(meters) && meters > 0) {
      maxDistanceKm = meters / 1000;
    }
  }

  // Оба написания имени: mobile исторически шлёт `min_rating`, документация
  // эндпоинта обещает `minRating`. До этого парсера `min_rating` молча терялся.
  const rawMinRating = (minRating != null && minRating !== '') ? minRating : min_rating;
  let minRatingValue = null;
  if (rawMinRating != null && rawMinRating !== '') {
    minRatingValue = parseFloat(rawMinRating);
    // Сохранено как было: NaN и 0 ложны, поэтому отсюда не отвергаются, а
    // ниже по конвейеру (`if (minRating)`) просто не применяются.
    if (minRatingValue && (isNaN(minRatingValue) || minRatingValue < 1 || minRatingValue > 5)) {
      throw new AppError('minRating must be between 1 and 5', 422, 'VALIDATION_ERROR');
    }
  }

  if (hours_filter && !VALID_HOURS_FILTERS.includes(hours_filter)) {
    throw new AppError(
      `Invalid hours_filter. Must be one of: ${VALID_HOURS_FILTERS.join(', ')}`,
      422,
      'VALIDATION_ERROR',
    );
  }

  return {
    categories: parseList(categories),
    cuisines: parseList(cuisines),
    priceRange: parseList(priceRange),
    minRating: minRatingValue,
    maxDistance: maxDistanceKm,
    radius: radiusKm,
    sortBy: sort_by ?? null,
    hoursFilter: hours_filter ?? null,
    features: parseList(features),
  };
}

/**
 * Только заданные фильтры — ключи со значением `null` выброшены.
 *
 * Зачем: у `searchService` свои умолчания в деструктуризации аргумента, а они
 * срабатывают лишь на `undefined`. Явный `sortBy: null` затёр бы `'rating'`,
 * явный `radius: null` провалил бы проверку диапазона. Отбрасывание пустых
 * ключей оставляет умолчания сервиса нетронутыми. / The service's parameter
 * defaults only fire on `undefined`, so passing an explicit `null` would
 * override them — dropping absent keys keeps those defaults in force.
 *
 * @param {object} parsed - результат parseSearchFilterParams
 * @returns {object}
 */
export function presentFilters(parsed) {
  const out = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (value != null) out[key] = value;
  }
  return out;
}
