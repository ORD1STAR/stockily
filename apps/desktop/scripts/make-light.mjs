// Builds the "light update" of a staged runtime: a small zip with only what changes between most
// releases (api, web, migrations, our own packages), plus light.json {version, baseId}.
//
//   node apps/desktop/scripts/make-light.mjs <version> <out.zip>
//
// Reads apps/desktop/src-tauri/resources/runtime (as left by build-runtime.mjs, with its base.json).
// Sign the result with `tauri signer sign` (release-on-server.sh does) and publish it with
// publish-release.mjs --light. No dependency: a tiny zip writer (deflate) on node:zlib.
import { crc32, deflateRawSync } from 'node:zlib';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const [version, outPath] = process.argv.slice(2);
if (!/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(version ?? '') || !outPath) {
  console.error('Usage : node make-light.mjs X.Y.Z out.zip');
  process.exit(1);
}
const here = dirname(fileURLToPath(import.meta.url));
const runtime = resolve(here, '..', 'src-tauri', 'resources', 'runtime');
const { baseId } = JSON.parse(readFileSync(join(runtime, 'base.json'), 'utf8'));

// What a light update may replace. Everything else (Node, Postgres, dependencies, the Prisma engine
// and generated client, runner.mjs) is the "base" that only a full installer changes.
const LIGHT_DIRS = ['api', 'web', 'migrations', join('node_modules', '@org')];

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (st.isFile()) files.push(p);
  }
};
for (const d of LIGHT_DIRS) walk(join(runtime, d));

const entries = [...files.map((f) => ({ name: relative(runtime, f).split(sep).join('/'), data: readFileSync(f) })), { name: 'light.json', data: Buffer.from(JSON.stringify({ version, baseId })) }];

const parts = [];
const central = [];
let offset = 0;
for (const e of entries) {
  const name = Buffer.from(e.name);
  const comp = deflateRawSync(e.data, { level: 9 });
  const crc = crc32(e.data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0x0800, 6); // UTF-8 names
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt32LE(0x00210000, 10); // fixed date/time (reproducible)
  local.writeUInt32LE(crc >>> 0, 14);
  local.writeUInt32LE(comp.length, 18);
  local.writeUInt32LE(e.data.length, 22);
  local.writeUInt16LE(name.length, 26);
  parts.push(local, name, comp);
  const c = Buffer.alloc(46);
  c.writeUInt32LE(0x02014b50, 0);
  c.writeUInt16LE(20, 4);
  c.writeUInt16LE(20, 6);
  c.writeUInt16LE(0x0800, 8);
  c.writeUInt16LE(8, 10);
  c.writeUInt32LE(0x00210000, 12);
  c.writeUInt32LE(crc >>> 0, 16);
  c.writeUInt32LE(comp.length, 20);
  c.writeUInt32LE(e.data.length, 24);
  c.writeUInt16LE(name.length, 28);
  c.writeUInt32LE(offset, 42);
  central.push(c, name);
  offset += local.length + name.length + comp.length;
}
const cdSize = central.reduce((n, b) => n + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(entries.length, 8);
end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(cdSize, 12);
end.writeUInt32LE(offset, 16);
writeFileSync(outPath, Buffer.concat([...parts, ...central, end]));
console.log(`Light update ${version}: ${entries.length} files, ${(statSync(outPath).size / 1e6).toFixed(1)} MB, base ${baseId.slice(0, 12)}…`);
