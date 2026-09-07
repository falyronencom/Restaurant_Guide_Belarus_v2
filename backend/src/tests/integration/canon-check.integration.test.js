/**
 * Integration — CAT-C-2.9 canon DB CHECK (migrations 030 + 031).
 *
 * Self-contained: builds a throwaway scratch database from production_schema.sql
 * + the two new migration files, so it exercises the REAL migration SQL
 * end-to-end without touching the shared restaurant_guide_test schema (which
 * correctly mirrors current prod, where 030/031 are not yet applied).
 *
 * Verifies the constraint semantics that guard Cyrillic-canon-at-rest:
 *   - canon values accepted; non-canon / empty / NULL-element rejected;
 *     NULL categories accepted (nullable column);
 *   - the normalize + dedupe replay repairs legacy English + the 'Кальян' stray
 *     and collapses the duplicate it can produce;
 *   - the migrations are idempotent (re-runnable);
 *   - the seed_import_registry phase/coords CHECKs hold.
 *
 * Требует живой Postgres и падает без него честно. Прежняя мягкая ветка
 * обещала пропуск ради «юнит-сьюта без контейнера», но такого прогона не
 * существует: все скрипты package.json запускают сьют целиком, а globalSetup
 * ходит в БД запросом без catch — при недоступном Postgres jest прерывается
 * раньше загрузки этого файла.
 */

import pg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../../../migrations');
const SCRATCH_DB = 'seed_canon_itest';

const CONN = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
};

const PARTNER_ID = '11111111-1111-1111-1111-111111111111';

const readMig = (name) => readFileSync(join(MIGRATIONS_DIR, name), 'utf8');

/** Minimal establishment INSERT — only the NOT NULL + tested columns. */
const insertEst = (client, { name, slug, categories, cuisines }) =>
  client.query(
    `INSERT INTO establishments
       (partner_id, name, city, address, latitude, longitude, categories, cuisines, working_hours, slug)
     VALUES ($1, $2, 'Минск', 'a', 53.9, 27.5, $3, $4, '{}', $5)`,
    [PARTNER_ID, name, categories, cuisines, slug],
  );

let scratchPool;

beforeAll(async () => {
  // 1. Create the scratch DB from a maintenance connection.
  // Подключение обязано удаться: globalSetup (jest.config.js) уже сходил в ту
  // же БД запросом без catch, и при недоступном Postgres прогон не дошёл бы
  // до этого файла. Прежняя мягкая ветка гасила все 11 тестов условием,
  // которое не может выполниться ни в одной среде.
  const admin = new pg.Client({ ...CONN, database: 'postgres' });
  await admin.connect();
  try {
    // Terminate any lingering backend from a crashed prior run, then recreate.
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`, [SCRATCH_DB],
    ).catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`);
    await admin.query(`CREATE DATABASE ${SCRATCH_DB}`);
  } finally {
    await admin.end();
  }

  // 2. Apply schema + both migrations to the scratch DB.
  scratchPool = new pg.Pool({ ...CONN, database: SCRATCH_DB, max: 1 });
  const c = await scratchPool.connect();
  try {
    await c.query(readMig('production_schema.sql'));
    await c.query(readMig('030_category_cuisine_canon_check.sql'));
    await c.query(readMig('031_seed_import_registry.sql'));
    await c.query(
      `INSERT INTO users (id, email, name, role, auth_method)
       VALUES ($1, 'canon@itest.local', 'Canon ITest', 'partner', 'email')
       ON CONFLICT (id) DO NOTHING`,
      [PARTNER_ID],
    );
  } finally {
    c.release();
  }
}, 60000);

afterAll(async () => {
  // Best-effort cleanup — a leftover scratch DB is harmless (beforeAll recreates
  // it), so a teardown hiccup must never turn a green run red.
  if (scratchPool) await scratchPool.end().catch(() => {});
  const admin = new pg.Client({ ...CONN, database: 'postgres' });
  try {
    await admin.connect();
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`, [SCRATCH_DB],
    ).catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`);
  } catch {
    /* leftover scratch DB is harmless */
  } finally {
    await admin.end().catch(() => {});
  }
}, 60000);

describe('canon CHECK — accept / reject', () => {
  test('accepts canonical categories + cuisines', async () => {
    await expect(
      insertEst(scratchPool, {
        name: 'A1', slug: 'a1',
        categories: ['Ресторан', 'Бар'], cuisines: ['Народная'],
      }),
    ).resolves.toBeDefined();
  });

  test('rejects a non-canonical category (English legacy)', async () => {
    await expect(
      insertEst(scratchPool, {
        name: 'A2', slug: 'a2', categories: ['restaurant'], cuisines: ['Народная'],
      }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  test('rejects a non-canonical cuisine', async () => {
    await expect(
      insertEst(scratchPool, {
        name: 'A3', slug: 'a3', categories: ['Ресторан'], cuisines: ['european'],
      }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  test('rejects an empty categories array', async () => {
    await expect(
      insertEst(scratchPool, {
        name: 'A4', slug: 'a4', categories: [], cuisines: ['Народная'],
      }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  test('rejects an empty cuisines array', async () => {
    await expect(
      insertEst(scratchPool, {
        name: 'A5', slug: 'a5', categories: ['Ресторан'], cuisines: [],
      }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  test('accepts NULL categories (nullable column)', async () => {
    await expect(
      insertEst(scratchPool, {
        name: 'A6', slug: 'a6', categories: null, cuisines: ['Народная'],
      }),
    ).resolves.toBeDefined();
  });

  test('rejects a NULL element inside categories', async () => {
    await expect(
      insertEst(scratchPool, {
        name: 'A7', slug: 'a7', categories: ['Ресторан', null], cuisines: ['Народная'],
      }),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('normalize + dedupe replay (migration 030 re-run)', () => {
  test('repairs legacy English + Кальян stray and collapses the dedupe artifact', async () => {
    const c = await scratchPool.connect();
    try {
      // Drop the constraints so dirty data can be inserted.
      await c.query('ALTER TABLE establishments DROP CONSTRAINT establishments_categories_canon_check');
      await c.query('ALTER TABLE establishments DROP CONSTRAINT establishments_cuisines_canon_check');

      await insertEst(c, {
        name: 'D1', slug: 'd1',
        categories: ['restaurant', 'bar'], cuisines: ['european', 'italian'],
      });
      // Both canon + legacy form present → array_replace makes a duplicate.
      await insertEst(c, {
        name: 'D2', slug: 'd2',
        categories: ['Кальянная', 'Кальян'], cuisines: ['Народная'],
      });

      // Re-run the whole migration: normalize → dedupe → re-add constraints.
      await c.query(readMig('030_category_cuisine_canon_check.sql'));

      const { rows } = await c.query(
        `SELECT name, categories, cuisines FROM establishments
         WHERE name IN ('D1','D2') ORDER BY name`,
      );
      expect(rows[0].categories).toEqual(['Ресторан', 'Бар']);
      expect(rows[0].cuisines).toEqual(['Европейская', 'Итальянская']);
      expect(rows[1].categories).toEqual(['Кальянная']); // duplicate collapsed
      expect(rows[1].cuisines).toEqual(['Народная']);
    } finally {
      c.release();
    }
  });

  test('constraints are back after the re-run (reject still fires)', async () => {
    await expect(
      insertEst(scratchPool, {
        name: 'D3', slug: 'd3', categories: ['cafe'], cuisines: ['Народная'],
      }),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('seed_import_registry (migration 031)', () => {
  test('accepts a valid phase and rejects an out-of-canon phase', async () => {
    await expect(
      scratchPool.query(
        `INSERT INTO seed_import_registry (stable_id, batch_id, content_hash, phase)
         VALUES ('minsk-001', 'b1', 'hash1', 'creating')`,
      ),
    ).resolves.toBeDefined();

    await expect(
      scratchPool.query(
        `INSERT INTO seed_import_registry (stable_id, batch_id, content_hash, phase)
         VALUES ('minsk-002', 'b1', 'hash2', 'bogus')`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  test('rejects an out-of-canon coords_source', async () => {
    await expect(
      scratchPool.query(
        `INSERT INTO seed_import_registry (stable_id, batch_id, content_hash, coords_source)
         VALUES ('minsk-003', 'b1', 'hash3', 'gps')`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
