/**
 * Switch an account on or off (users.is_active) — the way to revoke a
 * panel account (admin or viewer) once a demo or a collaboration is over.
 *
 * What deactivation does, by the backend's own checks:
 *   - login is refused at once (verifyCredentials filters is_active = true);
 *   - token refresh is refused at once (refreshAccessToken checks is_active);
 *   - an access token already issued stays valid until it expires
 *     (JWT_ACCESS_EXPIRY, 4h by default) — authenticate() verifies the
 *     signature only. Plan the revocation with that window in mind.
 *
 * Security model (mirrors set-partner-password.js):
 *   - Target database: with --production, DATABASE_URL from
 *     backend/.env.production (gitignored, user-managed, SSL enforced);
 *     without it, the DB_* variables of a local database.
 *   - Refuses to deactivate the last active admin: the panel must keep at
 *     least one account that can act.
 *   - Requires typing "yes" to confirm (skip with --yes).
 *
 * Usage:
 *   node scripts/set-user-active.js --email=guest@example.com --active=false --production
 *   node scripts/set-user-active.js --email=guest@example.com --active=true --production
 */
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { existsSync } from 'fs';
import { createInterface } from 'readline';
import pg from 'pg';
import dotenv from 'dotenv';

const { Client } = pg;

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : null;
};

const email = (option('email') || '').trim().toLowerCase();
const activeArg = option('active');
const production = hasFlag('production');
const skipConfirm = hasFlag('yes');

const usage = (problem) => {
  console.error(`❌ ${problem}`);
  console.error('');
  console.error('   node scripts/set-user-active.js --email=<email> --active=true|false [--production] [--yes]');
  process.exit(1);
};

if (!email || !email.includes('@')) usage('--email=<email> is required');
if (activeArg !== 'true' && activeArg !== 'false') usage('--active=true or --active=false is required');
const active = activeArg === 'true';

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
    const found = await client.query(
      'SELECT id, email, name, role, is_active FROM users WHERE email = $1',
      [email],
    );
    const account = found.rows[0];
    if (!account) {
      console.error(`❌ No account with e-mail ${email}.`);
      return 1;
    }

    console.log(`Account: ${account.email} (${account.name}), role ${account.role}, active ${account.is_active}`);
    console.log(`Target: ${production
      ? 'PRODUCTION (DATABASE_URL from backend/.env.production)'
      : `local ${client.host}:${client.port}/${client.database}`}`);

    if (account.is_active === active) {
      console.log(`Nothing to do: the account is already ${active ? 'active' : 'inactive'}.`);
      return 0;
    }

    if (!active && account.role === 'admin') {
      const admins = await client.query(
        "SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin' AND is_active = true",
      );
      if (admins.rows[0].count <= 1) {
        console.error('❌ Refusing: this is the last active admin. Create another admin first (create-admin.js).');
        return 1;
      }
    }

    console.log(`Will set is_active = ${active} for ${account.email}.`);
    if (!active) {
      console.log('   Login and token refresh stop immediately; an access token already issued expires within JWT_ACCESS_EXPIRY (4h by default).');
    }

    if (!skipConfirm && !(await confirm())) {
      console.log('Aborted.');
      return 1;
    }

    const result = await client.query(
      `UPDATE users SET is_active = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING email, role, is_active`,
      [active, account.id],
    );
    const updated = result.rows[0];
    console.log(`✅ ${updated.email} (${updated.role}) is now ${updated.is_active ? 'active' : 'inactive'}.`);
    return 0;
  } catch (error) {
    console.error('❌ Failed:', error.message);
    return 1;
  } finally {
    await client.end();
  }
};

process.exitCode = await main();
