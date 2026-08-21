import { Injectable } from '@nestjs/common';

// Deliberately in-memory for Milestone 1 (single-instance deployment,
// docs/Action Plan.md §4/§8 risk #4). A per-request DB round-trip for every
// guarded route would be wasteful for a check that changes rarely, but this
// cache is NOT shared across instances — once horizontal scaling is a real
// plan, replace this with a Redis-backed cache behind the same get/set/
// invalidate interface so callers don't need to change.
const TTL_MS = 30_000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

@Injectable()
export class EntitlementCacheService {
  private readonly store = new Map<string, CacheEntry<unknown>>();

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: Date.now() + TTL_MS });
  }

  // Called when an entitlement changes (activation, cancellation, trial
  // conversion) so a stale "not entitled" or "entitled" result can't linger
  // for up to TTL_MS after a real change. Not wired to any mutating
  // endpoint yet since none exist this milestone — the extension point for
  // future subscription-management code.
  invalidate(orgId: string, moduleKey: string): void {
    this.store.delete(`${orgId}:${moduleKey}`);
  }
}
