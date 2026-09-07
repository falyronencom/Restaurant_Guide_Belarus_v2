/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Сторож контракта провода с мобильным приложением.
 *
 * ЗАЧЕМ ЭТОТ ФАЙЛ СУЩЕСТВУЕТ.
 *
 * Приложение на устройстве пользователя между релизами не обновляется: iOS
 * ждёт совместного запуска, Android пересобирается по кабелю. Изменение формы
 * ответа доезжает до уже установленной сборки в тот же день, и разбор там
 * НЕ падает громко — он подставляет умолчание:
 *
 *   - пропал `access_token`  → пустая строка → вход «удался», а следующий
 *                              запрос получает 401 далеко от причины;
 *   - пропал `created_at`    → текущее время → уведомление навсегда
 *                              «Только что»;
 *   - переименован `totalPages` → единица → список замирает на первой
 *                              странице, кнопки «дальше» нет, ошибки нет;
 *   - переименован `establishments` / `reviews` → пустой список при живом
 *                              счётчике → экран говорит «ничего не найдено».
 *
 * Ни одно из этих состояний не отличимо от правды ни для гостя, ни для нас.
 * Жалоб не будет: экран выглядит исправным.
 *
 * Клиентская сторона каждого из этих случаев закреплена в
 * `mobile/test/models/*_contract_test.dart` — но те тесты ФИКСИРУЮТ поведение
 * разбора, а не замечают изменение сервера: переименуй здесь ключ, и они
 * останутся зелёными. Сигнал обязан звучать на той стороне, которая меняется.
 * Это и есть здесь.
 *
 * КАК ЧИТАТЬ ПАДЕНИЕ ЭТОГО ФАЙЛА.
 *
 * Красный тест здесь НЕ означает «сломан бэкенд». Он означает: «форма ответа
 * изменилась, и на устройствах, которые уже у людей, это проявится молча».
 * Дальше нужно решение, а не откат: либо ключ возвращают на место, либо
 * правку сопровождают пересборкой мобильного клиента, либо разбор в
 * приложении заранее учат новой форме. Список полей ниже — не украшение
 * проекции, а несущая конструкция чужого кода.
 */

import request from 'supertest';
import app from '../../server.js';
import { clearAllData, query } from '../utils/database.js';
import { createUserAndGetTokens } from '../utils/auth.js';
import { testUsers } from '../fixtures/users.js';

let partnerId;
let establishmentId;

const workingHours = JSON.stringify({
  monday: { open: '10:00', close: '22:00' },
  tuesday: { open: '10:00', close: '22:00' },
});

beforeAll(async () => {
  const partner = await createUserAndGetTokens(testUsers.partner);
  partnerId = partner.user.id;
});

beforeEach(async () => {
  await clearAllData();
  await query(
    'INSERT INTO users (id, email, password_hash, name, role, auth_method) VALUES ($1, $2, $3, $4, $5, $6)',
    [partnerId, 'partner@test.com', 'hash', 'Partner', 'partner', 'email']
  );

  const inserted = await query(`
    INSERT INTO establishments (id, partner_id, name, slug, description, city, address, latitude, longitude, categories, cuisines, status, working_hours, price_range, created_at, updated_at)
    VALUES (gen_random_uuid(), $1, 'Васильки', gen_random_uuid()::text, 'Описание', 'Минск', 'пр. Независимости, 43', 53.9023, 27.5619, ARRAY['Ресторан'], ARRAY['Народная'], 'active', $2::jsonb, '$$', NOW(), NOW())
    RETURNING id
  `, [partnerId, workingHours]);
  establishmentId = inserted.rows[0].id;
});

afterAll(async () => {
  await clearAllData();
});

/**
 * Поля, без которых `Establishment.fromJson` в приложении не собирает
 * карточку. Не «желательные» — несущие: их пропажа даёт исключение при
 * разборе и пустой экран, а не деградировавшую карточку.
 * Источник: `mobile/lib/models/establishment.dart`.
 */
const LOAD_BEARING_ESTABLISHMENT_FIELDS = [
  'id',
  'name',
  'address',
  'city',
  'status',
  'created_at',
  'updated_at',
];

describe('Контракт провода с mobile — список заведений', () => {
  test('конверт несёт establishments и pagination под своими именами', async () => {
    const res = await request(app)
      .get('/api/v1/search/establishments')
      .query({ city: 'Минск' })
      .expect(200);

    // Приложение читает ровно эти два ключа. Переименование любого даёт
    // пустой список при живом счётчике — «ничего не найдено» на экране.
    expect(Array.isArray(res.body.data.establishments)).toBe(true);
    expect(res.body.data.pagination).toBeDefined();
  });

  test('блок pagination несёт page, limit, total, totalPages', async () => {
    const res = await request(app)
      .get('/api/v1/search/establishments')
      .query({ city: 'Минск' })
      .expect(200);

    const p = res.body.data.pagination;

    // `establishments_service.dart` перекладывает limit → per_page и
    // totalPages → total_pages, а отсутствующее подставляет умолчанием.
    // Переименование `totalPages` схлопывает выдачу в одну страницу молча.
    expect(Object.keys(p).sort()).toEqual(
      expect.arrayContaining(['limit', 'page', 'total', 'totalPages'])
    );
    expect(typeof p.page).toBe('number');
    expect(typeof p.limit).toBe('number');
    expect(typeof p.total).toBe('number');
    expect(typeof p.totalPages).toBe('number');
  });

  test('каждое заведение несёт все несущие поля непустыми', async () => {
    const res = await request(app)
      .get('/api/v1/search/establishments')
      .query({ city: 'Минск' })
      .expect(200);

    const row = res.body.data.establishments[0];
    expect(row).toBeDefined();

    const missing = LOAD_BEARING_ESTABLISHMENT_FIELDS
      .filter((f) => row[f] === undefined || row[f] === null);

    expect(missing).toEqual([]);
  });

  test('координаты приходят числами, а не строками NUMERIC', async () => {
    // Приложение кастует их как `as num`. Строка (что node-pg отдаёт для
    // NUMERIC без явного каста) уронит разбор — на этот раз громко, но на
    // устройстве, которое не пересоберут.
    const res = await request(app)
      .get('/api/v1/search/establishments')
      .query({ city: 'Минск' })
      .expect(200);

    const row = res.body.data.establishments[0];
    expect(typeof row.latitude).toBe('number');
    expect(typeof row.longitude).toBe('number');
  });

  test('картинка карточки приходит как primary_image_url', async () => {
    // В списке нет `thumbnail_url`; приложение падает на `primary_image_url`
    // запасным вариантом. Ключ обязан присутствовать — пусть и со значением
    // null у карточки без фотографий.
    const res = await request(app)
      .get('/api/v1/search/establishments')
      .query({ city: 'Минск' })
      .expect(200);

    expect(res.body.data.establishments[0]).toHaveProperty('primary_image_url');
  });

  test('категории и кухни приходят массивами, а не строкой', async () => {
    const res = await request(app)
      .get('/api/v1/search/establishments')
      .query({ city: 'Минск' })
      .expect(200);

    const row = res.body.data.establishments[0];
    expect(Array.isArray(row.categories)).toBe(true);
    expect(Array.isArray(row.cuisines)).toBe(true);
  });
});

describe('Контракт провода с mobile — карточка заведения', () => {
  test('деталь несёт все несущие поля непустыми', async () => {
    const res = await request(app)
      .get(`/api/v1/search/establishments/${establishmentId}`)
      .expect(200);

    const row = res.body.data;
    const missing = LOAD_BEARING_ESTABLISHMENT_FIELDS
      .filter((f) => row[f] === undefined || row[f] === null);

    expect(missing).toEqual([]);
  });

  test('деталь несёт working_hours — иначе подпись «Открыто» врёт', async () => {
    // При отсутствии часов приложение падает на `status == "active"` и
    // рисует «Открыто» круглые сутки. Это молчаливая неправда, а не пробел.
    const res = await request(app)
      .get(`/api/v1/search/establishments/${establishmentId}`)
      .expect(200);

    expect(res.body.data).toHaveProperty('working_hours');
  });
});

describe('Контракт провода с mobile — список отзывов', () => {
  test('блок pagination отзывов несёт pages, а НЕ totalPages', async () => {
    // Асимметрия намеренная и закреплена с обеих сторон: поиск шлёт
    // `totalPages`, отзывы — `pages`. Приложение читает у каждого
    // эндпоинта своё имя. Приведение их «к единому виду» без правки
    // клиента остановит пролистывание отзывов молча.
    const res = await request(app)
      .get(`/api/v1/establishments/${establishmentId}/reviews`)
      .expect(200);

    const p = res.body.data.pagination;
    expect(p).toBeDefined();
    expect(Object.keys(p)).toEqual(
      expect.arrayContaining(['page', 'limit', 'total', 'pages'])
    );
    expect(Object.keys(p)).not.toContain('totalPages');
  });

  test('конверт отзывов несёт массив под ключом reviews', async () => {
    const res = await request(app)
      .get(`/api/v1/establishments/${establishmentId}/reviews`)
      .expect(200);

    expect(Array.isArray(res.body.data.reviews)).toBe(true);
  });
});
