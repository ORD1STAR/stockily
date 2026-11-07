import { CanActivate, ExecutionContext, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../../prisma/prisma.service';
import { REQUIRES_MODULE_KEY } from '../decorators/requires-module.decorator';
import { ModuleEntitlementException } from '../exceptions/module-entitlement.exception';
import { EntitlementCacheService } from '../services/entitlement-cache.service';
import { isLocalMode } from '../../../local/local-env';
import { getLocalActiveModuleKeys, refreshLocalEntitlements } from '../../../local/local-entitlements';

type CachedEntitlement = { status: string; trialEndsAt: Date | null; expiresAt: Date | null; deps: string[] } | null;

// Second guard in the chain — must run before PermissionGuard (docs/Action
// Plan.md §4): a role permission must never be able to outlive a lapsed
// module entitlement, so entitlement is checked first and independently of
// what the role happens to grant.
@Injectable()
export class ModuleEntitlementGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly cache: EntitlementCacheService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Method-level @RequiresModule wins; otherwise the controller's class-level one
    // (most controllers declare it once on the class — reading only the handler
    // used to skip the check entirely for them).
    const moduleKey = this.reflector.getAllAndOverride<string | undefined>(REQUIRES_MODULE_KEY, [context.getHandler(), context.getClass()]);
    if (!moduleKey) return true; // route doesn't declare @RequiresModule

    const req = context.switchToHttp().getRequest();
    const orgId: string | undefined = req.authUser?.orgId;
    if (!orgId) throw new UnauthorizedException();

    // Desktop (local) mode: trust the SIGNED license token's entitlements,
    // not the device's local database — editing the local
    // organization_module_entitlements table must not unlock a module (the
    // signature can't be forged). Falls back to the DB only before a license
    // has been loaded.
    if (isLocalMode()) {
      const keys = getLocalActiveModuleKeys();
      if (keys) {
        if (keys.has(moduleKey)) return true;
        // Not in the license we hold — but it may have been bought online since the last
        // renewal. Ask the server before saying no (no-op when offline).
        await refreshLocalEntitlements();
        if (getLocalActiveModuleKeys()?.has(moduleKey)) return true;
        throw new ModuleEntitlementException(moduleKey);
      }
    }

    const entitlement = await this.load(orgId, moduleKey);

    // A bought period ends at expiresAt (null = no end date) — enforced here
    // directly, not only by BillingScheduler's hourly status flip.
    if (!this.isUsable(entitlement)) throw new ModuleEntitlementException(moduleKey);

    // A module bought in self-service (it has an end date) cannot outlive the
    // modules it depends on: if one of them lapsed (e.g. Factures under
    // Ventes), the module is paused with a clear reason instead of limping on.
    // Admin grants (no end date) and trials are exempt, so an admin's
    // "forced" activation without dependencies keeps working.
    if (entitlement?.status === 'active' && entitlement.expiresAt) {
      for (const dep of entitlement.deps) {
        const depEnt = await this.load(orgId, dep);
        if (!this.isUsable(depEnt)) throw new ModuleEntitlementException(moduleKey, dep);
      }
    }
    return true;
  }

  private isUsable(e: CachedEntitlement): boolean {
    if (!e) return false;
    if (e.status === 'active') return !e.expiresAt || e.expiresAt.getTime() > Date.now();
    return e.status === 'trial' && !!e.trialEndsAt && e.trialEndsAt.getTime() > Date.now();
  }

  /** The org's entitlement for a module (and that module's dependencies), cached briefly. */
  private async load(orgId: string, moduleKey: string): Promise<CachedEntitlement> {
    const cacheKey = `${orgId}:${moduleKey}`;
    let entitlement = this.cache.get<CachedEntitlement>(cacheKey);
    if (entitlement === undefined) {
      const module = await this.prisma.module.findUnique({ where: { key: moduleKey } });
      if (!module) throw new NotFoundException(`Module inconnu : ${moduleKey}`);
      const row = await this.prisma.organizationModuleEntitlement.findUnique({
        where: { orgId_moduleId: { orgId, moduleId: module.id } },
      });
      entitlement = row ? { status: row.status, trialEndsAt: row.trialEndsAt, expiresAt: row.expiresAt, deps: module.dependencies ?? [] } : null;
      this.cache.set(cacheKey, entitlement);
    }
    return entitlement;
  }
}
