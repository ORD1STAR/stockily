# Milestone 11 — Offline desktop app (licensed, hardware-locked)

Most shops and depots have no reliable internet, so Stockily now ships a
Windows desktop app (`apps/desktop`). It looks exactly like the web app
(it *is* the web app), works for days or weeks offline, and syncs when the
PC gets even a few minutes of connection. A license can't be copied to
another PC or resold. Approved plan:
`~/.claude/plans/transient-scribbling-glacier.md`. Two decisions deviate from
it, both made with the user: the offline core is an **embedded Postgres
running the unchanged API** instead of a domain-package extraction plus
SQLite ports, and the shell is **Tauri (Rust)**. The Rust and MSVC
toolchains were installed for it.

## How it works

1. **Activation (online, once).** The shell signs in against the server,
   fingerprints the PC (motherboard UUID + board serial, system disk serial,
   MAC, each sha256-hashed on the device; raw IDs never leave it) and calls
   `POST /api/licensing/activate`. The server enforces the seat cap
   (active sites × `Organization.seatsPerSite`, default 3) and returns an
   **RS256 license** valid 45 days, bound to the composite fingerprint.
2. **Every start.** The shell loads the license from
   `%LOCALAPPDATA%\dz.ordi-tech.stockily\license.bin` (DPAPI-sealed) and
   verifies its signature against the public key compiled into the binary.
   It also checks the license matches *this* hardware. If online, it
   renews; the server can refuse (device deactivated or revoked), which sends
   the user back to activation. Without a valid license for this machine,
   only the activation screen is shown and the runtime never starts.
3. **Local runtime** (`apps/desktop/runtime/runner.mjs`, bundled `node.exe`).
   It starts a private Postgres (`embedded-postgres`, UTF-8 + ICU `fr`),
   applies the same migration files as the server, and runs the **same API
   build** with `STOCKILY_LOCAL_MODE=1`. The API listens on 127.0.0.1 only
   and serves the web app on the same origin. Logins check the local copy of
   the org's users (bcrypt hashes from the snapshot), so they work offline.
4. **Sync** (`apps/api/src/local`, every 20 s):
   - **push:** every successful local write was recorded in `local_outbox`,
     together with its local response and the document numbers it used.
     Writes are replayed in order on the server, as the user who made them
     (`POST /api/sync/session`). Ids the server assigns to rows created
     offline are paired with the local ones by walking both responses
     (identical code gives identical shapes) and rewritten into later entries.
   - **pull:** once nothing is pending, `GET /api/sync/snapshot` replaces
     the local copy (server is authoritative). It's one transaction with FK
     triggers off, so local sessions, the outbox and number blocks survive.
   - **conflict rule:** a replay the server rejects (4xx, e.g. stock already
     sold by another poste) is parked as `failed`, never auto-corrected or
     dropped. It shows on the device's *Synchronisation* page (retry, or
     admin-only abandon) and on the web *Appareils* page (from
     `sync_replay_log`).
5. **Offline-safe numbering (Décret 05-468).** All five counter queries now
   go through one allocator (`invoicing/document-numbering.ts`). A device
   reserves blocks of 50 numbers per series while online
   (`POST /api/sync/number-blocks`, which bumps the real counter). Offline, it
   numbers from its own block, so two postes never issue the same number. On
   replay, the server reuses the **printed** number after checking it
   belongs to that device's block. Unused numbers in a block are the only
   gaps, and `number_blocks` documents them. Inventaire (`INV`) has no block:
   it's online-only.
6. **Idempotency.** Replays carry the outbox entry id. `ReplayMiddleware`
   answers an already-applied key from `sync_replay_log` instead of applying
   it twice.
7. **Read-only after 45 days without renewal** (or after the device is
   deactivated or revoked): the local API refuses every recorded write with
   403 `license_expired`. Reading and printing still work, and the UI shows a
   banner. The lock is in the API itself, not just a hidden button.

Online-only on a device, proxied to the server as the same user (503 with
a clear message when offline): inventory counts, and device and sync
administration.

## Server additions

`DeviceActivation`, `NumberBlock`, `SyncReplayLog` (all RLS), device-only
`LocalOutboxEntry`/`LocalIdMap`, `Organization.seatsPerSite`. A `licensing`
module row with permission `licensing.device.manage` (Super Admin and
Gestionnaire). Endpoints: `licensing/{activate,renew,release,devices,
devices/:id/deactivate}`, `sync/{ping,session,snapshot,number-blocks,
replays}`. Deactivation frees the seat immediately: **no cooldown** (user
decision; the accepted risk is slow seat cycling). An anomaly signal (an
`audit_log` row) fires when more than 2 × seatsPerSite new devices activate
for one org within 24 h.

Signing: `LICENSE_PRIVATE_KEY` / `LICENSE_PUBLIC_KEY` (PEM, `\n`-escaped).
Without them the API uses an insecure dev pair, and refuses to sign with
`NODE_ENV=production`. **The production key must be generated on the
server and its public half compiled into the release build** (see below).

## Building the installer

```bash
node apps/desktop/scripts/build-runtime.mjs   # stages API + web + node.exe + Postgres (~276 MB, pruned)
cd apps/desktop && STOCKILY_LICENSE_PUBLIC_KEY_FILE=src-tauri/keys/license_public_prod.pem npx tauri build
# -> src-tauri/target/release/bundle/nsis/Stockily_0.1.0_x64-setup.exe (per-user install, no admin)
```

A build without `STOCKILY_LICENSE_PUBLIC_KEY_FILE` embeds the dev key and
only works against a dev server. Set `STOCKILY_REMOTE_ORIGIN` at build time
to target another server (default `https://stockily.ordi-tech.com`).

## Gotchas found by running it, not by reading it

- Windows `initdb` defaults to WIN1252, so the first migration containing
  `─` or Arabic text fails. The runner forces UTF-8.
- Tauri passes `\\?\C:\…` paths, which Node's module loader can't open, so
  the runtime died before writing any log. The shell strips the prefix and
  now captures the runtime's stderr in `logs/runtime-stderr.log`.
- Postgres runs with a restricted token on Windows, so WMI hides its
  ExecutablePath. Orphan cleanup (after a crash) matches on the command line.
- `@nestjs/jwt` prefers the global HS256 secret over a per-call
  `privateKey`, so RS256 keys are passed as the per-call `secret`.
- WebView2 doesn't reliably persist the web session across app restarts:
  staff sign in at each launch (against the local database, so offline too).
  Right after activation they land signed in (one-time session handed over in
  the URL fragment).

## How to verify

```bash
npx nx run-many -t lint typecheck build test --projects=web,api,domain-stock,infra-db
```
Green except `@org/api:typecheck`'s known e2e-spec `import()` quirk (now 6
errors instead of 4, from the two new specs below using the same pattern).
API suite: 66 tests, including `licensing.e2e.spec.ts` (seat cap, disk-swap
reuse, deactivate/renew/release, forged-token rejection) and
`sync.e2e.spec.ts` (sessions, blocks, replayed numbers, idempotency,
snapshot scoping).

Two scripted end-to-end runs used real processes, not mocks:
- **Server + device runtime** (39 checks). Offline the device creates a
  partner, a product, a stock entry and the legal profile, and finalizes
  **FA-2026-000001**. After reconnect the server holds the same number and
  the remapped partner, with stock 8. A forced license expiry blocks writes
  and allows reads. Two PCs sell the same last 8 units offline (FA-000002 and
  FA-000051, from separate blocks): one replay is accepted, the other is
  parked with "Stock insuffisant…", and server stock is 0, never negative.
- **The built Tauri app** (14 checks, driven through WebView2's DevTools
  port). Activation with wrong and right password, a ~10–30 s first start,
  auto sign-in, sync indicator, Appareils (1/3 seats), clean shutdown with
  no orphan Postgres, relaunch on the stored license, and a tampered
  license file sending the user back to activation.
