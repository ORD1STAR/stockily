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
