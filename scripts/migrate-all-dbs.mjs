// `npm run prisma:migrate` (== `prisma migrate dev`) only ever touches the
// one database named in the root `.env` (`stockily`). Three more databases
// exist on the same Postgres instance and are NOT kept in sync by that
// command — `stockily_test`, `stockily_invoicing_test` (hardcoded connection
// strings at the top of apps/api/src/*.e2e.spec.ts, overriding DATABASE_URL
// before the app module loads), and `stockily_invoicing_dev`. Forgetting
// this doesn't fail loudly at migration time — it surfaces later as a
// confusing `PrismaClientKnownRequestError: column ... does not exist` the
// next time `nx test api` runs against one of them.
//
// This script applies whatever migrations are already pending against
// `stockily` (via `prisma migrate dev`) to the other three too — run it
// after any schema change instead of the manual loop documented in
// docs/MILESTONE_7.md ("Multi-database migrations — a recurring gotcha this
// milestone"). Does NOT run the initial `prisma migrate dev` against the
// primary `stockily` database itself — run `npm run prisma:migrate` first,
// same as always, then this to fan the same migrations out.
import { execSync } from 'node:child_process';

const SCHEMA = 'packages/infra-db/prisma/schema.prisma';
const OTHER_DBS = ['stockily_test', 'stockily_invoicing_test', 'stockily_invoicing_dev'];

function run(cmd, extraEnv = {}) {
  execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...extraEnv } });
}

for (const db of OTHER_DBS) {
  const url = `postgresql://stockily:stockily@localhost:5432/${db}?schema=public`;
  console.log(`\n--- ${db} ---`);
  try {
    execSync(`docker compose exec -T postgres psql -U stockily -d stockily -c "CREATE DATABASE ${db}"`, { stdio: 'pipe' });
    console.log(`Created ${db}.`);
  } catch (err) {
    const stderr = err.stderr?.toString() ?? '';
    if (stderr.includes('already exists')) {
      console.log(`${db} already exists — continuing.`);
    } else {
      console.error(stderr || err.message);
      process.exit(1);
    }
  }
  run(`npx prisma migrate deploy --schema ${SCHEMA}`, { DATABASE_URL: url });
}

console.log('\nAll secondary databases are up to date.');
