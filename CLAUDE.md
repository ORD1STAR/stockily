<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->

# Stockily — project orientation

Modular stock/quality/invoicing platform (Algeria-targeted: Décret 05-468
invoice compliance, DZD-only). Full architecture and decision log:
`README.md` (quickstart, common commands) and `docs/Action Plan.md` (the
original technical plan). `docs/MILESTONE_1.md` through `docs/MILESTONE_10.md`
are the actual build log, one file per unit of work, each ending with a
"how to verify" section and every non-obvious decision explained — read the
latest one first for current state, not just this file.

**Before touching the schema**: `npm run prisma:migrate` only migrates the
one database in the root `.env`. Three more exist
(`stockily_test`, `stockily_invoicing_test`, `stockily_invoicing_dev`) and are
not kept in sync automatically — see `docs/MILESTONE_7.md`'s "Multi-database
migrations" section for the exact follow-up command. Skipping it doesn't
fail at migration time, only later as a confusing Prisma "column does not
exist" error from `nx test api`. On Windows, stop `nx serve api` first, or
the client-regeneration step fails with `EPERM`.

**Demo data** — `npm run db:seed:demo` creates a generic demo organization
for local development (see `README.md`). Never run it against production.

**Live HTTPS deployment for phone/mobile testing**: https://stockily.ordi-tech.com/
— reachable from a real phone (unlike `localhost:4200`), and already on
HTTPS so `getUserMedia`/camera APIs work (they require a secure context).
Use this instead of guessing a LAN IP when testing mobile-only behavior
(camera scanning, responsive layout, touch interactions). It's served by
a system-level nginx (root-owned, `/etc/nginx/sites-enabled/stockily.conf`,
Certbot-managed TLS) reverse-proxying `/api/*` to the `stockily-api`
container and everything else to `stockily-web` — both are the same
`docker-compose.yml` containers as local, just with a public front door.
To deploy a web change here: `sg docker -c "docker compose build web"` then
`sg docker -c "docker compose up -d web"` (swap `web` for `api`, or list
both, for a backend change — e.g. a schema/DTO change needs both a
migration against the shared `stockily` database, see above, and an `api`
rebuild) — the shell user isn't in the `docker` group in its *current*
login session even though `/etc/group` lists it (needs `sg docker` or a
fresh login to pick that up), and `sudo` needs a password this session
doesn't have.

**This deployment's database is separate from local dev's** — the
`contact@elwafa-grossiste.dz` demo org above only exists locally; on
`stockily.ordi-tech.com` the working login is `demo@stockily.dz` /
`Demo1234!` (org: Épicerie El Baraka).

**Verify before shipping**: `npx nx run-many -t lint typecheck build test
--projects=web,api,domain-stock,infra-db` should be fully green except
`@org/api:typecheck`'s four known e2e-spec errors (see MILESTONE_7 Round 6
— a narrow tsconfig project-reference quirk in the specs' own dynamic
`import()`, not a real bug). For anything UI-facing, actually click through
it in Chrome — this codebase's history is full of bugs that only build/lint
clean, found by nothing except actually using the running app.
