/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: utils/searchFilterParams.js
 *
 * Парсер общий для двух эндпоинтов, и в этом весь смысл проверок ниже:
 * классический GET читает фильтры из query-строки (всё — строки), умный POST —
 * из JSON-тела (массивы и числа приходят типизированными). Один и тот же экран
 * mobile ходит то туда, то сюда в зависимости от того, пуста ли строка поиска,
 * поэтому расхождение в разборе видно пользователю как «фильтр то работает, то
 * нет». / One parser, two call sites with different input types — a divergence
 * here shows up to the user as a filter that works only half the time.
 */

import { parseSearchFilterParams, presentFilters } from '../../utils/searchFilterParams.js';

describe('parseSearchFilterParams — списки', () => {
  test('csv-строка и массив дают один результат', () => {
    const fromCsv = parseSearchFilterParams({ categories: 'Бар, Паб' });
    const fromArray = parseSearchFilterParams({ categories: ['Бар', 'Паб'] });

    expect(fromCsv.categories).toEqual(['Бар', 'Паб']);
    expect(fromArray.categories).toEqual(['Бар', 'Паб']);
  });

  test('пустой список — null, а не пустой массив', () => {
    // Отсутствие фильтра обязано читаться как отсутствие. Цена вопроса не
    // одинакова по размерностям: `priceRange` в `searchService` проверяется
    // голым `if (priceRange)`, и пустой массив уходит в SQL как `= ANY('{}')`
    // — ноль строк; `categories`/`cuisines`/`features` там прикрыты
    // `length > 0`. Правило общее, но сторожит оно в первую очередь цену.
    expect(parseSearchFilterParams({ features: [] }).features).toBeNull();
    expect(parseSearchFilterParams({ features: '' }).features).toBeNull();
    expect(parseSearchFilterParams({ features: ' , ' }).features).toBeNull();
  });

  test('cuisines, priceRange и features разбираются теми же правилами', () => {
    const parsed = parseSearchFilterParams({
      cuisines: 'Японская,Итальянская',
      priceRange: [' $ ', '$$'],
      features: 'wifi , terrace',
    });

    expect(parsed.cuisines).toEqual(['Японская', 'Итальянская']);
    expect(parsed.priceRange).toEqual(['$', '$$']);
    expect(parsed.features).toEqual(['wifi', 'terrace']);
  });
});

describe('parseSearchFilterParams — числовые размерности', () => {
  test('max_distance приходит в метрах, отдаётся в километрах', () => {
    expect(parseSearchFilterParams({ max_distance: '3000' }).maxDistance).toBe(3);
    expect(parseSearchFilterParams({ max_distance: 1500 }).maxDistance).toBe(1.5);
  });

  test('нулевой и нечисловой max_distance молча не применяется (не ошибка)', () => {
    // Сохранённое поведение классического контроллера: расстояние — мягкий
    // фильтр, кривое значение просто снимает его.
    expect(parseSearchFilterParams({ max_distance: '0' }).maxDistance).toBeNull();
    expect(parseSearchFilterParams({ max_distance: 'abc' }).maxDistance).toBeNull();
    expect(parseSearchFilterParams({ max_distance: '-500' }).maxDistance).toBeNull();
  });

  test('radius разбирается, нечисловой — 422 с прежним текстом', () => {
    expect(parseSearchFilterParams({ radius: '5' }).radius).toBe(5);

    expect(() => parseSearchFilterParams({ radius: 'abc' })).toThrow('Invalid radius');
    try {
      parseSearchFilterParams({ radius: 'abc' });
    } catch (e) {
      expect(e.statusCode).toBe(422);
      expect(e.code).toBe('VALIDATION_ERROR');
    }
  });

  test('отсутствующий radius — null: умолчание подставляет вызывающий', () => {
    // Вернуть здесь 10 значило бы навязать умолчание и умному поиску, где
    // radius вообще не обязателен.
    expect(parseSearchFilterParams({}).radius).toBeNull();
  });
});

describe('parseSearchFilterParams — minRating и min_rating', () => {
  test('оба написания принимаются', () => {
    // mobile исторически шлёт min_rating; до общего парсера классический
    // контроллер читал только minRating и молча терял фильтр.
    expect(parseSearchFilterParams({ minRating: '4.5' }).minRating).toBe(4.5);
    expect(parseSearchFilterParams({ min_rating: '4.5' }).minRating).toBe(4.5);
    expect(parseSearchFilterParams({ min_rating: 4 }).minRating).toBe(4);
  });

  test('camelCase выигрывает, когда пришли оба', () => {
    expect(parseSearchFilterParams({ minRating: '5', min_rating: '2' }).minRating).toBe(5);
  });

  test('вне диапазона 1..5 — 422 с прежним текстом', () => {
    expect(() => parseSearchFilterParams({ minRating: '6' }))
      .toThrow('minRating must be between 1 and 5');
    expect(() => parseSearchFilterParams({ min_rating: '0.5' }))
      .toThrow('minRating must be between 1 and 5');
  });

  test('нечисловой и нулевой рейтинг не отвергаются — сохранённое поведение', () => {
    // Классический контроллер проверял `minRatingValue && ...`: NaN и 0 ложны,
    // до броска не доходило, а ниже по конвейеру `if (minRating)` их не
    // применял. Ужесточить это — отдельное решение, не побочный эффект выноса.
    expect(parseSearchFilterParams({ minRating: 'abc' }).minRating).toBeNaN();
    expect(parseSearchFilterParams({ minRating: '0' }).minRating).toBe(0);
  });
});

describe('parseSearchFilterParams — hours_filter', () => {
  test('три допустимых значения проходят', () => {
    for (const value of ['until_22', 'until_morning', '24_hours']) {
      expect(parseSearchFilterParams({ hours_filter: value }).hoursFilter).toBe(value);
    }
  });

  test('чужое значение — 422 с перечислением допустимых', () => {
    expect(() => parseSearchFilterParams({ hours_filter: 'bogus' }))
      .toThrow('Invalid hours_filter. Must be one of: until_22, until_morning, 24_hours');
    try {
      parseSearchFilterParams({ hours_filter: 'bogus' });
    } catch (e) {
      expect(e.statusCode).toBe(422);
    }
  });
});

describe('presentFilters', () => {
  test('выбрасывает ключи со значением null', () => {
    // Умолчания searchService живут в деструктуризации аргумента и срабатывают
    // только на undefined. Явный `sortBy: null` затёр бы 'rating', явный
    // `radius: null` провалил бы проверку диапазона внутри searchByRadius.
    const parsed = parseSearchFilterParams({ priceRange: '$$', sort_by: 'rating' });
    const present = presentFilters(parsed);

    expect(present).toEqual({ priceRange: ['$$'], sortBy: 'rating' });
    expect('radius' in present).toBe(false);
    expect('hoursFilter' in present).toBe(false);
  });

  test('пустой источник даёт пустой объект', () => {
    expect(presentFilters(parseSearchFilterParams({}))).toEqual({});
  });

  test('NaN-рейтинг сохраняется — он не null', () => {
    // Иначе поведение разошлось бы с классикой, которая передавала NaN дальше.
    expect(presentFilters(parseSearchFilterParams({ minRating: 'abc' })).minRating).toBeNaN();
  });
});
