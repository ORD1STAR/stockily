import { SetMetadata } from '@nestjs/common';

export const REQUIRES_MODULE_KEY = 'requiresModule';

// Gates a route behind an active (or still-in-trial) module entitlement for
// the caller's organization. Checked by ModuleEntitlementGuard, which must
// run before PermissionGuard in the chain (docs/Action Plan.md §4) — a role
// permission should never outlive a lapsed module entitlement.
export const RequiresModule = (moduleKey: string) => SetMetadata(REQUIRES_MODULE_KEY, moduleKey);
