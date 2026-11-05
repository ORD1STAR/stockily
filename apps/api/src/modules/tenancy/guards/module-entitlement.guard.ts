import { CanActivate, ExecutionContext, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../../prisma/prisma.service';
import { REQUIRES_MODULE_KEY } from '../decorators/requires-module.decorator';
import { ModuleEntitlementException } from '../exceptions/module-entitlement.exception';
import { EntitlementCacheService } from '../services/entitlement-cache.service';
import { isLocalMode } from '../../../local/local-env';
import { getLocalActiveModuleKeys } from '../../../local/local-entitlements';

type CachedEntitlement = { status: string; trialEndsAt: Date | null } | null;

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
        throw new ModuleEntitlementException(moduleKey);
      }
    }

    const cacheKey = `${orgId}:${moduleKey}`;
    let entitlement = this.cache.get<CachedEntitlement>(cacheKey);

    if (entitlement === undefined) {
      const module = await this.prisma.module.findUnique({ where: { key: moduleKey } });
      if (!module) throw new NotFoundException(`Module inconnu : ${moduleKey}`);

      const row = await this.prisma.organizationModuleEntitlement.findUnique({
        where: { orgId_moduleId: { orgId, moduleId: module.id } },
      });
      entitlement = row ? { status: row.status, trialEndsAt: row.trialEndsAt } : null;
      this.cache.set(cacheKey, entitlement);
    }

    const isActive = entitlement?.status === 'active';
    const isValidTrial =
      entitlement?.status === 'trial' && !!entitlement.trialEndsAt && entitlement.trialEndsAt.getTime() > Date.now();

    if (!isActive && !isValidTrial) {
      throw new ModuleEntitlementException(moduleKey);
    }
    return true;
  }
}
