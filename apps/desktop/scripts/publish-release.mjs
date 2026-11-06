// Publishes a built desktop installer on the server so that it is downloadable
// from the website and offered to installed apps as an update.
//
//   node apps/desktop/scripts/publish-release.mjs <Stockily_X.Y.Z_x64-setup.exe | Stockily_X.Y.Z_amd64.AppImage> [--notes "What's new"] [--dir ./releases]
//
// Needs, next to the installer, the `.sig` file that `tauri build` writes when
// TAURI_SIGNING_PRIVATE_KEY is set (the app refuses an update whose signature
// does not verify against the public key compiled into it).
// Copies the installer into the releases directory (default ./releases, the
// folder mounted read-only into the API container), computes its SHA-256 and
// size, and updates manifest.json atomically. Re-running with the same version
// replaces that entry. Nothing to restart: the API re-reads the manifest.
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const notes = flag('--notes') ?? '';
const lightZip = flag('--light'); // Stockily_X.Y.Z_light-<platform>.zip (+ .sig next to it)
const baseId = flag('--base-id');
const dir = resolve(flag('--dir') ?? process.env.RELEASES_DIR ?? 'releases');
const installer = args[0] ? resolve(args[0]) : null;
const fail = (m) => {
  console.error(`Erreur : ${m}`);
  process.exit(1);
};

if (!installer) fail('indiquez le chemin de l’installeur (Stockily_X.Y.Z_x64-setup.exe).');
const name = basename(installer);
const m = /^Stockily_(\d{1,4}\.\d{1,4}\.\d{1,4})_(x64-setup\.exe|amd64\.AppImage)$/.exec(name);
if (!m) fail(`nom inattendu "${name}" (attendu : Stockily_X.Y.Z_x64-setup.exe ou Stockily_X.Y.Z_amd64.AppImage).`);
const version = m[1];
const platform = m[2].endsWith('.exe') ? 'windows' : 'linux';
if (!existsSync(installer)) fail(`fichier introuvable : ${installer}`);
const sigPath = `${installer}.sig`;
if (!existsSync(sigPath)) fail(`signature introuvable : ${sigPath} (construisez avec TAURI_SIGNING_PRIVATE_KEY).`);
const signature = readFileSync(sigPath, 'utf8').trim();

const sha256 = await new Promise((ok, ko) => {
  const h = createHash('sha256');
  createReadStream(installer).on('data', (c) => h.update(c)).on('end', () => ok(h.digest('hex'))).on('error', ko);
});

mkdirSync(dir, { recursive: true });
const dest = join(dir, name);
if (resolve(dest) !== installer) copyFileSync(installer, dest);
chmodSync(dest, 0o644);
const size = statSync(dest).size;

const manifestPath = join(dir, 'manifest.json');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { releases: [] };
manifest.releases = (manifest.releases ?? []).filter((r) => !(r.platform === platform && r.version === version));
const entry = { platform, version, file: name, sha256, size, signature, notes, publishedAt: new Date().toISOString() };
if (lightZip) {
  const zip = resolve(lightZip);
  const lightName = basename(zip);
  if (lightName !== `Stockily_${version}_light-${platform}.zip`) fail(`nom inattendu "${lightName}" (attendu : Stockily_${version}_light-${platform}.zip).`);
  if (!/^[0-9a-f]{64}$/.test(baseId ?? '')) fail('--base-id (empreinte de base, 64 caractères hexadécimaux) est requis avec --light.');
  if (!existsSync(zip) || !existsSync(`${zip}.sig`)) fail(`mise à jour légère ou signature introuvable : ${zip}(.sig)`);
  const lightSha = await new Promise((ok, ko) => {
    const hh = createHash('sha256');
    createReadStream(zip).on('data', (c) => hh.update(c)).on('end', () => ok(hh.digest('hex'))).on('error', ko);
  });
  const lightDest = join(dir, lightName);
  if (resolve(lightDest) !== zip) copyFileSync(zip, lightDest);
  chmodSync(lightDest, 0o644);
  entry.baseId = baseId;
  entry.light = { file: lightName, sha256: lightSha, size: statSync(lightDest).size, signature: readFileSync(`${zip}.sig`, 'utf8').trim() };
}
manifest.releases.push(entry);
const tmp = join(dirname(manifestPath), `.manifest.${process.pid}.tmp`);
writeFileSync(tmp, JSON.stringify(manifest, null, 2) + '\n');
chmodSync(tmp, 0o644);
renameSync(tmp, manifestPath);

console.log(`${entry.light ? `Mise à jour légère : ${entry.light.size} octets\n` : ''}Version ${version} (${platform}) publiée : ${dest}\n  taille  ${size} octets\n  sha256  ${sha256}\n  manifeste  ${manifestPath}`);
