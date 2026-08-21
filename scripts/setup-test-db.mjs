// Prepares a separate `stockily_test` database (same docker-compose Postgres
// instance, different database name) for apps/api's e2e test. A separate
// database rather than a mocked Prisma client: this milestone IS the
// tenancy/permission logic, and mocking the DB away would test nothing
// meaningful about it (see docs/MILESTONE_1.md).
//
// Run manually — `npm run test:e2e:db:setup` — once, or again after a
// schema change. Not run automatically inside the Jest suite itself, so the
// e2e test stays fast and doesn't shell out on every run.
import { execSync } from 'node:child_process';

const TEST_DB_URL = 'postgresql://stockily:stockily@localhost:5432/stockily_test?schema=public';
const SCHEMA = 'packages/infra-db/prisma/schema.prisma';

function run(cmd, extraEnv = {}) {
  execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...extraEnv } });
}

try {
  execSync('docker compose exec -T postgres psql -U stockily -d stockily -c "CREATE DATABASE stockily_test"', {
    stdio: 'pipe',
  });
  console.log('Created stockily_test database.');
} catch (err) {
  const stderr = err.stderr?.toString() ?? '';
  if (stderr.includes('already exists')) {
    console.log('stockily_test database already exists — continuing.');
  } else {
    console.error(stderr || err.message);
    process.exit(1);
  }
}

console.log('Applying migrations to stockily_test...');
run(`npx prisma migrate deploy --schema ${SCHEMA}`, { DATABASE_URL: TEST_DB_URL });

console.log('Seeding stockily_test...');
run(`npx prisma db seed --schema ${SCHEMA}`, { DATABASE_URL: TEST_DB_URL });

console.log('stockily_test is ready.');
