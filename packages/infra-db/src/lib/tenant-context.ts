import { AsyncLocalStorage } from 'node:async_hooks';

// Request-scoped tenant context for Postgres RLS (docs/Action Plan.md §2,
// docs/MILESTONE_6.md "RLS — deliberately not implemented"). Plain Node
// AsyncLocalStorage, not a Nest construct, so this stays usable by a future
// Local/Electron adaptation with no Nest at all (Action Plan §6) — apps/api's
// TenantContextMiddleware is the only Nest-specific piece that populates it.

interface TenantStore {
  orgId: string;
}

const storage = new AsyncLocalStorage<TenantStore>();

/**
 * Runs `fn` with `orgId` available to every Prisma query made during its
 * execution (including anything awaited inside it) via `getCurrentTenantId`.
 * `withTenantRls`'s extension reads this to issue the RLS session variable.
 *
 * Deliberately `await`s `fn()` *inside* the `storage.run()` callback rather
 * than returning the bare promise — verified empirically to matter (see
 * this milestone's notes): Prisma's `.findMany()` etc. return a lazy,
 * un-awaited "PrismaPromise" that does no actual work until awaited. If
 * `run()`'s callback just returns that promise without awaiting it, `run()`
 * exits (synchronously) before any real query executes, and the caller ends
 * up awaiting it from *outside* the ALS-active window — so the extension
 * sees no tenant context at all. Awaiting here keeps the whole chain,
 * including every downstream Prisma call the extension intercepts,
 * causally rooted inside the active store.
 */
export async function runWithTenant<T>(orgId: string, fn: () => T | Promise<T>): Promise<T> {
  return storage.run({ orgId }, async () => await fn());
}

export function getCurrentTenantId(): string | undefined {
  return storage.getStore()?.orgId;
}
