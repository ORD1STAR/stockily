// In local (desktop) mode, module entitlements come from the SIGNED license
// token, not the device's local database — so a cracker editing
// `organization_module_entitlements` in their own Postgres unlocks nothing
// (they can't forge the RS256 signature). LocalStateService sets this
// whenever the license changes; ModuleEntitlementGuard reads it.
//
// A plain module singleton (like tenant-context's ALS) rather than a DI
// provider, so the guard — which lives in TenancyModule — can consult it
// without a cross-module dependency on the desktop-only LocalModule.

let activeModuleKeys: Set<string> | null = null;

export function setLocalActiveModuleKeys(keys: string[] | null): void {
  activeModuleKeys = keys ? new Set(keys) : null;
}

/** null = unknown (no license yet) → the guard falls back to the DB. */
export function getLocalActiveModuleKeys(): Set<string> | null {
  return activeModuleKeys;
}

// When a module is refused, the device asks the server before saying no (the
// customer may have just bought it): LocalStateService registers the function
// that renews the signed license online. Returns true when a new license was loaded.
let refresher: (() => Promise<boolean>) | null = null;

export function setLocalEntitlementRefresher(fn: (() => Promise<boolean>) | null): void {
  refresher = fn;
}

export async function refreshLocalEntitlements(): Promise<boolean> {
  return refresher ? refresher() : false;
}
