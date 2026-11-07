// Stockily desktop — local runtime ("sidecar"), started by the Tauri shell
// once the device's license has been verified. Brings up the device's own
// private Postgres, migrates it, then runs the exact same Stockily API as
// the server, in local mode (outbox + sync, see apps/api/src/local).
//
// Env from the shell: STOCKILY_DATA_DIR, PORT, STOCKILY_LICENSE_TOKEN,
// STOCKILY_REMOTE_ORIGIN, STOCKILY_CONTROL_SECRET, LICENSE_PUBLIC_KEY.
// Stops Postgres cleanly when the shell goes away (stdin closes).
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Postgres binaries come from the platform package this runtime was staged with.
const { pg_ctl } = await import(process.platform === 'win32' ? '@embedded-postgres/windows-x64' : '@embedded-postgres/linux-x64');
const root = dirname(fileURLToPath(import.meta.url));
// A light update (see apps/desktop/src-tauri/src/light.rs) brings newer api/web/migrations in a data
// folder; everything heavy (Node, Postgres, dependencies) stays here in `root`.
const content = process.env.STOCKILY_CONTENT_DIR || root;
if (content !== root) {
  // The light content has no node_modules of its own (only our packages in node_modules/@org): any other
  // dependency is looked up from the installed runtime. NODE_PATH alone is not enough, ES modules ignore it.
  const { registerHooks } = await import('node:module');
  const fromRoot = pathToFileURL(join(root, 'runner.mjs')).href;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context);
      } catch (err) {
        const bare = !/^(\.{0,2}\/|[a-z]+:)/i.test(specifier);
        if (!bare || !['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(err?.code)) throw err;
        return nextResolve(specifier, { ...context, parentURL: fromRoot });
      }
    },
  });
}
const dataDir = process.env.STOCKILY_DATA_DIR;
if (!dataDir) throw new Error('STOCKILY_DATA_DIR is required');
mkdirSync(join(dataDir, 'logs'), { recursive: true });
const logFile = join(dataDir, 'logs', 'runtime.log');
const log = (...args) => {
  const line = `[${new Date().toISOString()}] ${args.join(' ')}`;
  console.log(line);
  try {
    appendFileSync(logFile, line + '\n');
  } catch {
    /* logging must never take the runtime down */
  }
};

// Per-install secrets: the local Postgres password and the local JWT
// secret (local sessions are signed on-device, never by the server's key).
const secretsPath = join(dataDir, 'secrets.json');
if (!existsSync(secretsPath)) {
  writeFileSync(secretsPath, JSON.stringify({ pgPassword: randomBytes(24).toString('hex'), jwtSecret: randomBytes(48).toString('hex') }));
}
const secrets = JSON.parse(readFileSync(secretsPath, 'utf8'));

const freePort = () =>
  new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

const pgDir = join(dataDir, 'pgdata');
const pgPort = await freePort();
const db = new EmbeddedPostgres({
  databaseDir: pgDir,
  user: 'stockily',
  password: secrets.pgPassword,
  port: pgPort,
  persistent: true,
  // initdb would otherwise inherit the Windows code page (WIN1252), which
  // can't store Arabic text (amounts in words, partner names). ICU French
  // collation keeps name sorting (É, à…) like a French user expects.
  initdbFlags: ['--encoding=UTF8', '--locale=C', '--locale-provider=icu', '--icu-locale=fr'],
  onLog: () => {},
  onError: (e) => log('postgres:', String(e).trim().slice(0, 500)),
});

if (!existsSync(join(pgDir, 'PG_VERSION'))) {
  log('First start: initialising the local database');
  await db.initialise();
}
try {
  await db.start();
} catch (err) {
  // A previous run that was killed can leave its postgres behind, holding the data dir.
  log('Postgres did not start, stopping a leftover instance and retrying:', String(err));
  try {
    execFileSync(pg_ctl, ['stop', '-D', pgDir, '-m', 'fast'], { stdio: 'ignore' });
  } catch {
    /* nothing was running */
  }
  // A crash can leave postmaster.pid behind with a PID Windows has since
  // reused — postgres then refuses to start. Only delete it once pg_ctl
  // confirms no server owns this data dir (exit code 3 = not running);
  // deleting it under a live server would risk corrupting the database.
  try {
    execFileSync(pg_ctl, ['status', '-D', pgDir], { stdio: 'ignore' });
  } catch (status) {
    if (status.status === 3) rmSync(join(pgDir, 'postmaster.pid'), { force: true });
  }
  await db.start();
}

let stopping = false;
const shutdown = async (code = 0) => {
  if (stopping) return;
  stopping = true;
  log('Shutting down');
  try {
    await db.stop();
  } catch (err) {
    log('postgres stop failed:', String(err));
  }
  process.exit(code);
};
process.stdin.on('end', () => void shutdown());
process.stdin.on('close', () => void shutdown());
process.stdin.resume();
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

const adminUrl = `postgresql://stockily:${secrets.pgPassword}@127.0.0.1:${pgPort}`;
{
  const c = new pg.Client({ connectionString: `${adminUrl}/postgres` });
  await c.connect();
  const exists = await c.query(`SELECT 1 FROM pg_database WHERE datname = 'stockily'`);
  if (exists.rowCount === 0) await c.query('CREATE DATABASE stockily');
  await c.end();
}

// The same migration files the server runs (packages/infra-db/prisma/migrations),
// applied in order with a tiny tracking table — no Prisma CLI on the device.
{
  const c = new pg.Client({ connectionString: `${adminUrl}/stockily` });
  await c.connect();
  await c.query('CREATE TABLE IF NOT EXISTS "_stockily_migrations" (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const done = new Set((await c.query('SELECT name FROM "_stockily_migrations"')).rows.map((r) => r.name));
  const dir = join(content, 'migrations');
  for (const name of readdirSync(dir).filter((n) => existsSync(join(dir, n, 'migration.sql'))).sort()) {
    if (done.has(name)) continue;
    log('Applying migration', name);
    await c.query('BEGIN');
    try {
      await c.query(readFileSync(join(dir, name, 'migration.sql'), 'utf8'));
      await c.query('INSERT INTO "_stockily_migrations"(name) VALUES ($1)', [name]);
      await c.query('COMMIT');
    } catch (err) {
      await c.query('ROLLBACK');
      log('Migration failed', name, String(err));
      await c.end();
      await shutdown(1);
    }
  }
  await c.end();
}

Object.assign(process.env, {
  NODE_ENV: 'production',
  STOCKILY_LOCAL_MODE: '1',
  DATABASE_URL: `${adminUrl}/stockily?schema=public`,
  // Same restricted role as the server (created by the RLS migration), so
  // row-level security behaves identically on the device.
  APP_DATABASE_URL: `postgresql://stockily_app:stockily_app@127.0.0.1:${pgPort}/stockily?schema=public`,
  JWT_SECRET: secrets.jwtSecret,
  STOCKILY_WEB_DIR: join(content, 'web'),
  CORS_ORIGIN: `http://127.0.0.1:${process.env.PORT ?? 3000}`,
});

log(`Local database on port ${pgPort}; starting the Stockily API on port ${process.env.PORT}`);
createRequire(import.meta.url)(join(content, 'api', 'main.js'));
