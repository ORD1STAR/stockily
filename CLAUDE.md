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
original technical plan). `docs/MILESTONE_1.md` through `docs/MILESTONE_7.md`
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

**Demo login** — a real signed-up org (not `npm run db:seed:demo`'s generic
wireframe-matching data, a separate thing): `contact@elwafa-grossiste.dz` /
`Wafa2026!`, a grocery wholesaler with 3 sites, 12 products, and real
stock/quality/invoicing history built up live during Milestone 7's
walkthrough.

**Verify before shipping**: `npx nx run-many -t lint typecheck build test
--projects=web,api,domain-stock,infra-db` should be fully green except
`@org/api:typecheck`'s four known e2e-spec errors (see MILESTONE_7 Round 6
— a narrow tsconfig project-reference quirk in the specs' own dynamic
`import()`, not a real bug). For anything UI-facing, actually click through
it in Chrome — this codebase's history is full of bugs that only build/lint
clean, found by nothing except actually using the running app.
