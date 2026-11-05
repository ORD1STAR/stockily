// Stages everything the desktop app runs locally into
// apps/desktop/src-tauri/resources/runtime (bundled by Tauri as a resource):
//   node.exe, runner.mjs, api/ (built API), web/ (built frontend, API on
//   the same origin), migrations/, and a node_modules trimmed to the API's
//   real runtime dependencies + the embedded Postgres binaries.
// Usage: node apps/desktop/scripts/build-runtime.mjs   (from the repo root)
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const out = join(repo, 'apps', 'desktop', 'src-tauri', 'resources', 'runtime');
const run = (cmd, opts = {}) => {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: repo, ...opts, env: { ...process.env, ...(opts.env ?? {}) } });
};
const version = (pkg) => JSON.parse(readFileSync(join(repo, 'node_modules', pkg, 'package.json'), 'utf8')).version;

// The API's runtime imports (apps/api + packages/*), pinned to exactly what
// the repo builds and tests against.
const API_DEPS = [
  '@nestjs/common', '@nestjs/config', '@nestjs/core', '@nestjs/event-emitter', '@nestjs/jwt',
  '@nestjs/platform-express', '@nestjs/platform-socket.io', '@nestjs/schedule', '@nestjs/throttler',
  '@nestjs/websockets', '@prisma/client', '@fontsource/noto-naskh-arabic', 'bcryptjs', 'bwip-js',
  'class-transformer', 'class-validator', 'helmet', 'nodemailer', 'pdfkit', 'reflect-metadata',
  'rxjs', 'socket.io', 'tslib',
];
const RUNNER_DEPS = { 'embedded-postgres': '18.6.0-beta.19', pg: '8.23.1' };
const WORKSPACE_PACKAGES = ['domain-invoicing', 'domain-quality', 'domain-stock', 'domain-tenancy', 'infra-db', 'shared-types'];

run('npx nx build api --configuration=production');
// The desktop frontend calls the API on its own origin (served by the local API).
run('npx nx build web --skip-nx-cache', { env: { VITE_API_URL: '/api' } });

// Retries: antivirus scanners briefly lock freshly written files on Windows.
rmSync(out, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
mkdirSync(out, { recursive: true });

writeFileSync(
  join(out, 'package.json'),
  JSON.stringify(
    {
      name: 'stockily-desktop-runtime',
      private: true,
      dependencies: { ...Object.fromEntries(API_DEPS.map((d) => [d, version(d)])), ...RUNNER_DEPS },
    },
    null,
    2,
  ),
);
run('npm install --no-workspaces --omit=dev --no-audit --no-fund --no-package-lock', { cwd: out });

for (const p of WORKSPACE_PACKAGES) {
  const src = join(repo, 'packages', p);
  const dest = join(out, 'node_modules', '@org', p);
  mkdirSync(dest, { recursive: true });
  cpSync(join(src, 'package.json'), join(dest, 'package.json'));
  cpSync(join(src, 'dist'), join(dest, 'dist'), { recursive: true });
}

// Generated Prisma client + Windows query engine: the one the repo just
// generated for this exact schema (same @prisma/client version, pinned above).
run('npx prisma generate --schema packages/infra-db/prisma/schema.prisma');
cpSync(join(repo, 'node_modules', '.prisma', 'client'), join(out, 'node_modules', '.prisma', 'client'), {
  recursive: true,
  filter: (f) => !/\.tmp\d*$/.test(f), // leftovers from engine swaps during earlier generates
});

// Dead weight for this runtime (~200 MB): the generated client only loads
// runtime/library.js (native Postgres engine) — not the WebAssembly engines
// for other databases/edge runtimes; and the Postgres build ships pgAdmin's
// GUI libraries (wx*) and message translations the server never needs.
const prune = (dir, test) => {
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir)) if (test(f)) rmSync(join(dir, f), { recursive: true, force: true });
};
prune(join(out, 'node_modules', '@prisma', 'client', 'runtime'), (f) => /wasm|edge|react-native/.test(f));
prune(join(out, 'node_modules', '@embedded-postgres', 'windows-x64', 'native', 'bin'), (f) => /^wx|^testplug/.test(f));
rmSync(join(out, 'node_modules', '@embedded-postgres', 'windows-x64', 'native', 'share', 'locale'), { recursive: true, force: true });

cpSync(join(repo, 'apps', 'api', 'dist'), join(out, 'api'), { recursive: true, filter: (f) => !f.endsWith('.map') });
cpSync(join(repo, 'apps', 'web', 'dist'), join(out, 'web'), { recursive: true });
cpSync(join(repo, 'packages', 'infra-db', 'prisma', 'migrations'), join(out, 'migrations'), { recursive: true });
cpSync(join(repo, 'apps', 'desktop', 'runtime', 'runner.mjs'), join(out, 'runner.mjs'));
cpSync(process.execPath, join(out, 'node.exe'));

const size = (p) => (statSync(p).isDirectory() ? readdirSync(p).reduce((n, c) => n + size(join(p, c)), 0) : statSync(p).size);
console.log(`\nRuntime staged in ${out} (${Math.round(size(out) / 1e6)} MB)`);
if (!existsSync(join(out, 'node_modules', '.prisma', 'client'))) throw new Error('Prisma client was not generated');
