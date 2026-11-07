// Stages everything the desktop app runs locally into
// apps/desktop/src-tauri/resources/runtime (bundled by Tauri as a resource):
//   node.exe, runner.mjs, api/ (built API), web/ (built frontend, API on
//   the same origin), migrations/, and a node_modules trimmed to the API's
//   real runtime dependencies + the embedded Postgres binaries.
// Usage: node apps/desktop/scripts/build-runtime.mjs   (from the repo root)
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Usage: node apps/desktop/scripts/build-runtime.mjs [--target=windows|linux]   (default: windows)
// Building the Windows runtime on Linux/macOS (the server): everything Windows-specific is fetched
// for win32-x64 instead of copied from this machine (node.exe, Postgres, Prisma engine).
// The Linux runtime is built natively and can only be built on Linux x64.
const TARGET = (process.argv.find((a) => a.startsWith('--target='))?.split('=')[1] ?? 'windows');
if (!['windows', 'linux'].includes(TARGET)) throw new Error('--target must be windows or linux');
if (TARGET === 'linux' && !(process.platform === 'linux' && process.arch === 'x64')) throw new Error('The Linux runtime must be built on Linux x64.');
const CROSS = TARGET === 'windows' && process.platform !== 'win32';
const PG_PKG = TARGET === 'windows' ? 'windows-x64' : 'linux-x64';
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
run(`npm install --no-workspaces --omit=dev --no-audit --no-fund --no-package-lock${CROSS ? ' --os=win32 --cpu=x64' : ''}`, { cwd: out });

for (const p of WORKSPACE_PACKAGES) {
  const src = join(repo, 'packages', p);
  const dest = join(out, 'node_modules', '@org', p);
  mkdirSync(dest, { recursive: true });
  cpSync(join(src, 'package.json'), join(dest, 'package.json'));
  cpSync(join(src, 'dist'), join(dest, 'dist'), { recursive: true });
}

// Generated Prisma client + Windows query engine: the one the repo just
// generated for this exact schema (same @prisma/client version, pinned above).
if (CROSS) {
  // Same schema with the Windows engine added to the client's targets (kept next to the real one so paths resolve; removed right after).
  const schemaDir = join(repo, 'packages', 'infra-db', 'prisma');
  const cross = join(schemaDir, 'schema.cross.prisma');
  const src = readFileSync(join(schemaDir, 'schema.prisma'), 'utf8');
  writeFileSync(cross, src.replace('provider = "prisma-client-js"', 'provider = "prisma-client-js"\n  binaryTargets = ["native", "windows"]'));
  try {
    run('npx prisma generate --schema packages/infra-db/prisma/schema.cross.prisma');
  } finally {
    rmSync(cross, { force: true });
  }
} else {
  run('npx prisma generate --schema packages/infra-db/prisma/schema.prisma');
}
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
prune(join(out, 'node_modules', '@embedded-postgres', PG_PKG, 'native', 'bin'), (f) => /^wx|^testplug/.test(f));
rmSync(join(out, 'node_modules', '@embedded-postgres', PG_PKG, 'native', 'share', 'locale'), { recursive: true, force: true });

// Linux: npm's postinstall made the Postgres shared libraries symlinks (libpq.so.5 -> libpq.so.5.18…).
// Bundling and AppImage packing don't reliably keep links, so turn each one into a real copy.
const unlink = (dir) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) {
      const real = realpathSync(p);
      rmSync(p);
      cpSync(real, p);
    } else if (st.isDirectory()) unlink(p);
  }
};
// Linux: the Perl/Python procedural languages need system libraries that aren't there (and aren't wanted);
// the AppImage packer also refuses a bundle containing binaries with unresolvable dependencies.
if (TARGET === 'linux') prune(join(out, 'node_modules', '@embedded-postgres', PG_PKG, 'native', 'lib', 'postgresql'), (f) => /plperl|plpython|pltcl|^dblink|^postgres_fdw|^libpqwalreceiver/.test(f));
if (TARGET === 'linux') unlink(join(out, 'node_modules', '@embedded-postgres', PG_PKG));

cpSync(join(repo, 'apps', 'api', 'dist'), join(out, 'api'), { recursive: true, filter: (f) => !f.endsWith('.map') });
cpSync(join(repo, 'apps', 'web', 'dist'), join(out, 'web'), { recursive: true });
cpSync(join(repo, 'packages', 'infra-db', 'prisma', 'migrations'), join(out, 'migrations'), { recursive: true });
cpSync(join(repo, 'apps', 'desktop', 'runtime', 'runner.mjs'), join(out, 'runner.mjs'));
if (CROSS) {
  // The official Windows node.exe of the exact version running this script, checked against nodejs.org's SHASUMS256.
  const base = `https://nodejs.org/dist/${process.version}`;
  const get = async (u) => Buffer.from(await (await fetch(u)).arrayBuffer());
  const exe = await get(`${base}/win-x64/node.exe`);
  const sums = (await get(`${base}/SHASUMS256.txt`)).toString();
  const want = sums.split('\n').find((l) => l.endsWith(' win-x64/node.exe'))?.split(/\s+/)[0];
  const got = createHash('sha256').update(exe).digest('hex');
  if (!want || want !== got) throw new Error(`node.exe checksum mismatch (${got} vs ${want})`);
  writeFileSync(join(out, 'node.exe'), exe);
} else if (TARGET === 'linux') {
  cpSync(process.execPath, join(out, 'node'));
  chmodSync(join(out, 'node'), 0o755);
} else {
  cpSync(process.execPath, join(out, 'node.exe'));
}

// The "base" fingerprint: everything a light update cannot change (Node, Postgres, dependencies, the
// Prisma engine + generated client, runner.mjs). A light update only applies to an app with the same base.
{
  const skip = new Set(['api', 'web', 'migrations', 'base.json']);
  const h = createHash('sha256');
  const walk = (dir, rel) => {
    for (const name of readdirSync(dir).sort()) {
      const r = rel ? `${rel}/${name}` : name;
      if (!rel && skip.has(name)) continue;
      if (r === 'node_modules/@org') continue;
      const p = join(dir, name);
      const st = lstatSync(p);
      if (st.isDirectory()) walk(p, r);
      else if (st.isFile()) h.update(`${r}\0${createHash('sha256').update(readFileSync(p)).digest('hex')}\n`);
    }
  };
  walk(out, '');
  const baseId = h.digest('hex');
  writeFileSync(join(out, 'base.json'), JSON.stringify({ baseId, target: TARGET }));
  console.log(`Base fingerprint (${TARGET}): ${baseId}`);
}

const size = (p) => (statSync(p).isDirectory() ? readdirSync(p).reduce((n, c) => n + size(join(p, c)), 0) : statSync(p).size);
console.log(`\nRuntime staged in ${out} (${Math.round(size(out) / 1e6)} MB)`);
if (!existsSync(join(out, 'node_modules', '.prisma', 'client'))) throw new Error('Prisma client was not generated');
