/**
 * Create (or reset) a read-only `viewer` account for the admin panel.
 *
 * Why a separate role: the panel is hosted on Railway and one of our own
 * people may show it to a prospective partner. A full admin account cannot
 * be handed out for that — every button acts on real partners — so the panel
 * has a second role that can read everything and change nothing
 * (SDL CAT-C-2.11, 2026-09-08; tiers in src/routes/v1/adminRoutes.js).
 *
 * Security model (mirrors set-partner-password.js):
 *   - Target database: with --production, DATABASE_URL from
 *     backend/.env.production (gitignored, user-managed, SSL enforced);
 *     without it, the DB_* variables of a local database.
 *   - The password comes from the VIEWER_PASSWORD env var — never an
 *     argument, so it does not land in shell history. It is never printed.
 *   - Never touches an account of another role: this script cannot demote
 *     an admin by accident. To promote a viewer, use create-admin.js.
 *   - Requires typing "yes" to confirm (skip with --yes).
 *
 * Requires migration 034 (viewer in the users.role CHECK) on the target DB.
 *
 * Usage (PowerShell):
 *   $env:VIEWER_PASSWORD = "choose-a-strong-password"
 *   node scripts/create-viewer.js --email=guest@example.com --name="Гость" --production
 *   Remove-Item Env:\VIEWER_PASSWORD
 *
 * Usage (bash):
 *   VIEWER_PASSWORD='choose-a-strong-password' \
 *     node scripts/create-viewer.js --email=guest@example.com --name="Гость" --production
 */
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { existsSync } from 'fs';
import { createInterface } from 'readline';
import pg from 'pg';
import argon2 from 'argon2';
import dotenv from 'dotenv';

const { Client } = pg;

// Same Argon2id parameters the backend uses; argon2.verify reads them from
// the hash, so the login matches regardless.
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 16384,
  timeCost: 3,
  parallelism: 1,
};

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : null;
};

const email = (option('email') || '').trim().toLowerCase();
const name = (option('name') || 'Просмотр').trim();
const production = hasFlag('production');
const skipConfirm = hasFlag('yes');
const password = process.env.VIEWER_PASSWORD;

const usage = (problem) => {
  console.error(`❌ ${problem}`);
  console.error('');
  console.error('   VIEWER_PASSWORD=... node scripts/create-viewer.js --email=<email> [--name="<name>"] [--production] [--yes]');
  process.exit(1);
};

if (!email || !email.includes('@')) usage('--email=<email> is required');
if (!password) usage('Set the password via the VIEWER_PASSWORD env var (not an argument)');
if (password.length < 8) usage('Password must be at least 8 characters');

const buildClient = () => {
  if (production) {
    const envPath = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), '.env.production');
    if (!existsSync(envPath)) {
      console.error('❌ Missing backend/.env.production (needs DATABASE_URL). See scripts/README-MIGRATIONS.md');
      process.exit(1);
    }
    dotenv.config({ path: envPath });
    if (!process.env.DATABASE_URL) {
      console.error('❌ DATABASE_URL not set in backend/.env.production');
      process.exit(1);
    }
    return new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
  }
  return new Client({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'restaurant_guide_belarus',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres_dev_password',
  });
};

const confirm = () => new Promise((resolveAnswer) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.question('Type "yes" to continue: ', (answer) => {
    rl.close();
    resolveAnswer(answer.trim().toLowerCase() === 'yes');
  });
});

const main = async () => {
  const client = buildClient();
  await client.connect();
  try {
    const existing = await client.query(
      'SELECT id, role, is_active FROM users WHERE email = $1',
      [email],
    );
    const row = existing.rows[0];

    if (row && row.role !== 'viewer') {
      console.error(`❌ ${email} already exists with role '${row.role}'.`);
      console.error('   This script never changes an account of another role.');
      return 1;
    }

    console.log(row
      ? `Will RESET the viewer account ${email}: new password, name "${name}", active.`
      : `Will CREATE the viewer account ${email} (name "${name}").`);
    console.log(`Target: ${production
      ? 'PRODUCTION (DATABASE_URL from backend/.env.production)'
      : `local ${client.host}:${client.port}/${client.database}`}`);

    if (!skipConfirm && !(await confirm())) {
      console.log('Aborted.');
      return 1;
    }

    const passwordHash = await argon2.hash(password, ARGON2_OPTIONS);

    const result = row
      ? await client.query(
        `UPDATE users
         SET password_hash = $1, name = $2, is_active = true, updated_at = NOW()
         WHERE id = $3
         RETURNING id, email, role, name, is_active`,
        [passwordHash, name, row.id],
      )
      : await client.query(
        `INSERT INTO users (
           id, email, password_hash, name, role, auth_method,
           email_verified, is_active, created_at, updated_at
         )
         VALUES (gen_random_uuid(), $1, $2, $3, 'viewer', 'email', true, true, NOW(), NOW())
         RETURNING id, email, role, name, is_active`,
        [email, passwordHash, name],
      );

    const account = result.rows[0];
    console.log(`✅ Viewer ${row ? 'updated' : 'created'}: ${account.email} (${account.name}), role ${account.role}, active ${account.is_active}`);
    console.log('   Sign in at the admin panel with this e-mail and the password you set.');
    return 0;
  } catch (error) {
    if (error.code === '23514') {
      console.error('❌ users.role CHECK rejected \'viewer\' — migration 034_viewer_role is not applied on this database.');
      console.error('   node scripts/apply-migration-production.js 034_viewer_role');
    } else {
      console.error('❌ Failed:', error.message);
    }
    return 1;
  } finally {
    await client.end();
  }
};

process.exitCode = await main();
