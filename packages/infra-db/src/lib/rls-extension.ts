import { Prisma, PrismaClient } from '@prisma/client';
import { getCurrentTenantId } from './tenant-context.js';

// Prisma Client Extension implementing the RLS session-variable handoff
// flagged since Milestone 1 (docs/Action Plan.md §2, docs/MILESTONE_6.md
// "RLS — deliberately not implemented") — the actual `ALTER TABLE ... ENABLE
// ROW LEVEL SECURITY` + `CREATE POLICY` statements live in a raw-SQL
// migration, not here; this only makes sure every query carries
// `app.tenant_id` for those policies to check against.
//
// Two cases, handled differently — verified empirically against a real
// Postgres instance before writing this (see the milestone notes for the
// probe scripts), not assumed from documentation:
//
// 1. A normal, non-transactional call (`prisma.product.findMany(...)`, the
//    vast majority of queries in this codebase). Wrapped in a *batch*
//    `$transaction([setConfig, query])` — one throwaway transaction per
//    call, safe because nothing else shares its connection.
// 2. A call made from inside an existing interactive transaction
//    (`prisma.$transaction(async (tx) => { tx.product.create(...) })` —
//    invoicing finalize, payment recording, auth signup). Naively repeating
//    case 1 here — starting a *second*, independent `$transaction([...])`
//    from inside the callback — does not throw, but silently runs on a
//    separate connection: any write inside it would survive even if the
//    *outer* transaction later rolled back, silently breaking the exact
//    atomicity (invoice numbering + stock deduction, org + first user) those
//    call sites open a transaction for in the first place. So this case is
//    detected (via `__internalParams.transaction`, the one reliable signal
//    found by probing — see below) and *not* re-wrapped: the calling code is
//    responsible for issuing `SELECT set_config('app.tenant_id', ..., true)`
//    itself, once, as the transaction's own first statement (Postgres
//    `SET LOCAL`/`set_config(..., true)` lasts for the whole transaction,
//    not just one statement, so every subsequent `tx.x.y()` call inherits it
//    for free).
//
// `__internalParams` is not part of Prisma's public/documented extension API
// — it could change shape in a future `@prisma/client` upgrade. If it ever
// stops reporting `.transaction` for an interactive-transaction call, this
// silently falls back to case 1's behaviour, which would reproduce exactly
// the silent-atomicity-break case above. `rls.e2e.spec.ts`'s dedicated
// rollback-atomicity test exists specifically to catch that regression in
// CI rather than in production — do not remove it in a future Prisma
// version bump without replacing it with an equivalent check.
export function withTenantRls(client: PrismaClient) {
  return client.$extends({
    name: 'tenant-rls',
    query: {
      $allModels: {
        async $allOperations({ args, query, __internalParams }: any) {
          const orgId = getCurrentTenantId();
          if (!orgId) {
            // No tenant context (unauthenticated endpoints — signup, login,
            // refresh — or a script/seed run outside the request pipeline).
            // Those call sites are responsible for their own explicit
            // set_config where they legitimately need tenant-scoped access
            // (see auth.service.ts's signup transaction).
            return query(args);
          }

          const insideInteractiveTransaction = Boolean(__internalParams?.transaction);
          if (insideInteractiveTransaction) {
            return query(args);
          }

          const [, result] = await client.$transaction([
            client.$executeRaw(Prisma.sql`SELECT set_config('app.tenant_id', ${orgId}, true)`),
            query(args),
          ]);
          return result;
        },
      },
    },
  });
}

/** For call sites opening their own `prisma.$transaction(async (tx) => ...)` — see the module doc above for why this can't be automatic. */
export function setTenantOnTransaction(tx: Prisma.TransactionClient, orgId: string) {
  return tx.$executeRaw(Prisma.sql`SELECT set_config('app.tenant_id', ${orgId}, true)`);
}
