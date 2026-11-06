// Sets the desktop app version everywhere it lives (the updater compares these):
//   node apps/desktop/scripts/set-version.mjs 0.2.0
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const v = process.argv[2];
if (!/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(v ?? '')) {
  console.error('Usage : node set-version.mjs X.Y.Z');
  process.exit(1);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const edit = (file, fn) => {
  const p = join(root, file);
  writeFileSync(p, fn(readFileSync(p, 'utf8')));
};
edit('package.json', (s) => s.replace(/"version": "[^"]+"/, `"version": "${v}"`));
edit('src-tauri/tauri.conf.json', (s) => s.replace(/"version": "[^"]+"/, `"version": "${v}"`));
edit('src-tauri/Cargo.toml', (s) => s.replace(/^version = "[^"]+"/m, `version = "${v}"`));
console.log(`Version ${v} appliquée (package.json, tauri.conf.json, Cargo.toml).`);
