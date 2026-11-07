# Desktop app: download page and auto-update

## What exists

- **Download page** `/telecharger` (header "Télécharger", footer, home page): shows the latest Windows version,
  size, date, notes and SHA-256, and links to `GET /api/downloads/windows/latest`.
- **Server** (`apps/api/src/modules/releases`, server-only, not loaded in local/desktop mode):
  - `GET /api/downloads` public info; `GET /api/downloads/:platform/:version` (`latest` or `X.Y.Z`) the installer.
  - `GET /api/updates/:target/:arch/:current_version` Tauri updater endpoint (204 = up to date, else
    `{version, notes, pub_date, url, signature}`).
  - Files live in `./releases` (mounted read-only at `/data/releases`), described by `releases/manifest.json`.
- **Desktop app** (`apps/desktop/src-tauri/src/updater.rs`): checks on every launch, downloads a newer version
  with progress and installs it (the installer relaunches the app); in the background it also pre-downloads new
  versions every 6 h to `<app data>/updates/pending.bin` and installs them at the next launch before anything starts.
  Update trouble never blocks opening the app.

## Security

- A download request names only a platform and a version. The file name comes from the manifest and must be
  exactly `Stockily_X.Y.Z_x64-setup.exe`; it must be a regular file (symlinks refused) inside the releases directory,
  with the recorded size, and its SHA-256 must equal the manifest's (re-checked whenever the file changes).
  Anything else is a 404. Throttled to 20/min/IP; HTTP ranges supported for resumable downloads.
- Updates are signed with a minisign key (Tauri). The public key is compiled into the app
  (`tauri.conf.json > plugins.updater.pubkey`); the app refuses any package whose signature does not verify, so
  even a compromised server or network cannot push code. **The private key is not on the server.**

## Windows and Linux

Two builds of the same app, each with its own track in the manifest (`PLATFORMS` in `releases.service.ts`):

| | Windows | Linux |
|---|---|---|
| File | `Stockily_X.Y.Z_x64-setup.exe` (NSIS) | `Stockily_X.Y.Z_amd64.AppImage` |
| Updater target | `windows` / `x86_64` | `linux` / `x86_64` |
| License sealed on disk with | DPAPI | AES-256-GCM, key from `/etc/machine-id` + user (`dpapi.rs`) |
| Hardware fingerprint | WMI (board UUID/serial, disk serial) + registry MachineGuid + MAC | DMI if readable, else `/etc/machine-id`; disk serial from sysfs or `/dev/disk/by-id`; MAC (`fingerprint.rs`) |
| Local engine | `node.exe` + Windows embedded Postgres | `node` + `@embedded-postgres/linux-x64` (`runtime.rs`, `runner.mjs`) |
| Data folder | `%LOCALAPPDATA%\dz.ordi-tech.stockily` | `~/.local/share/dz.ordi-tech.stockily` |

A license issued for a PC does not carry over to the other system: the fingerprint is per machine and per platform.
The Linux build needs a recent 64-bit distribution with WebKitGTK 4.1 (Ubuntu 22.04+/Debian 12+/Fedora 38+);
the AppImage updates itself in place (Tauri's updater replaces the AppImage file). Mac is not built (use the web app).
The Linux runtime strips Postgres' Perl/Python/Tcl languages and `dblink`/`postgres_fdw`/`libpqwalreceiver`
(not used, and the AppImage packer refuses binaries with unresolvable libraries).

## Light updates (small downloads)

A full installer is 66 MB (Windows) / 177 MB (Linux), but most releases only change the API, the web app and the
migrations (≈ 1 MB zipped). So each release is published twice:

- the **full installer** (Tauri updater), and
- a **light zip** `Stockily_X.Y.Z_light-<platform>.zip` (`api/`, `web/`, `migrations/`, `node_modules/@org/`), signed with
  the same minisign key, tied to a **base fingerprint** (`baseId`).

The *base* is everything a light update cannot change: Node, Postgres, all dependencies, the Prisma engine + generated
client, `runner.mjs`. `build-runtime.mjs` hashes it into `runtime/base.json` (verified reproducible between builds). A
schema change regenerates the Prisma client, so it changes the base and needs a full installer.

Flow (`apps/desktop/src-tauri/src/light.rs`, `updater.rs`): the app asks
`GET /api/updates/light/{target}/x86_64/{baseId}/{effectiveVersion}` and gets `none` (up to date), `light` (same base: download the
zip) or `full` (base changed: normal installer). A light zip is applied only if its size, SHA-256 and minisign signature
match, and only files under the 4 allowed folders are extracted (no `..`, no links, size/count caps). It is extracted to
`<data>/content/<version>/` and switched with one file write; the app then restarts (the launch screen needs no restart).
The engine runs on it via `STOCKILY_CONTENT_DIR`; shared dependencies are found in the installed runtime by a resolve
hook in `runner.mjs`. If the app cannot start on the new content, it is discarded and the installed version starts.
A full installer at least as new (or a different base) makes the light content obsolete; it is deleted.

Not light (needs the installer): a new Node/Postgres/dependency, a change to `runner.mjs`, or a Prisma schema change.

## Publishing a version

**On this server**: `apps/desktop/scripts/release-on-server.sh 0.2.0 "What's new" [all|windows|linux]`
(default `all`) builds and publishes both, one after the other (~25 min for Windows, ~10 min for Linux).
Linux is built natively (`apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev
librsvg2-dev patchelf libssl-dev libxdo-dev`). For Windows, the script sets the version, stages the Windows runtime (Windows `node.exe` checked against nodejs.org's SHASUMS, Windows
Postgres and Prisma engine), builds the NSIS installer with `cargo-xwin`, signs it with `~/.stockily-updater/`,
and publishes it. Takes ~25 min on 2 cores / 4 GB (LTO is off here to fit in memory, so the .exe is a bit
larger than a Windows-built one). Toolchain installed once: `apt install clang lld llvm nsis`, rustup with target
`x86_64-pc-windows-msvc`, `cargo install cargo-xwin --locked`. ~3 GB of disk for `src-tauri/target` and ~2 GB
for `~/.cache/cargo-xwin`. Disk is tight on this server: delete `apps/desktop/src-tauri/target` and
`apps/desktop/src-tauri/resources/runtime` after a release (they are rebuilt next time).

**On Windows** (or the GitHub workflow *Desktop installer (Windows)*):
   ```
   node apps/desktop/scripts/set-version.mjs 0.2.0
   $env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content stockily-updater.key -Raw)
   $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<password>"
   $env:STOCKILY_LICENSE_PUBLIC_KEY_FILE = "<production license public key .pem>"
   cd apps/desktop; npm run package
   ```
   then copy `Stockily_0.2.0_x64-setup.exe` + `.sig` from `src-tauri/target/release/bundle/nsis/` to the server and run
   `node apps/desktop/scripts/publish-release.mjs <exe> --notes "..."`.

`publish-release.mjs` (with `--light <zip> --base-id <id>`, done by `release-on-server.sh`) copies the installer into `./releases`, records size + SHA-256 + signature in `manifest.json`
(atomically). No restart: the API re-reads the manifest within 5 s. Installed apps pick the version up at their
next launch (or after a background pre-download).

## Updater signing key

Generated once with `npx tauri signer generate`. The private key + password are in `~/.stockily-updater/` on the
server: **back them up elsewhere** (and put them in GitHub secrets `TAURI_SIGNING_PRIVATE_KEY` /
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if you also build there). Lose them and installed apps can never update again
(they would need a manual reinstall with a new public key).

## What is verified

Server side and website: tested (`apps/api/src/releases.spec.ts`) and live. Both installers **build** (updater code
compiles, bundles + signatures produced, 0.1.0 published for both and downloadable with the right SHA-256).
- Windows: **never run on Windows** (cross-compiled): do a first install, publish a 0.1.1 and watch it update.
- Linux: the engine (embedded Postgres 18 with ICU, migrations, API boot) was run natively; the AppImage starts under a
  virtual display and opens its window; license sealing and the fingerprint have unit tests (`cargo test --lib`).
  Not yet exercised on a real desktop: the license activation and an actual in-place update.

Light updates: unit-tested in Rust (`cargo test --lib`: hostile zips, wrong base/version, tampered package, real
production signature via `LIGHT_TEST_ZIP`) and on the server (`releases.spec.ts`); the engine was started from a light
content folder outside the install. Not yet exercised: a real light update on an installed Windows/Linux app (the first
release with this system is 0.1.5; the first light update is the one after it).

Disk note: `.dockerignore` excludes `src-tauri/target`, `src-tauri/resources` and `releases` (before, each Docker build
copied several GB of desktop build output).
