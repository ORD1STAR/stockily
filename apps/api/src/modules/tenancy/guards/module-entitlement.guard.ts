import { CanActivate, ExecutionContext, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../../prisma/prisma.service';
import { REQUIRES_MODULE_KEY } from '../decorators/requires-module.decorator';
import { ModuleEntitlementException } from '../exceptions/module-entitlement.exception';
import { EntitlementCacheService } from '../services/entitlement-cache.service';

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
    const moduleKey = this.reflector.get<string | undefined>(REQUIRES_MODULE_KEY, context.getHandler());
    if (!moduleKey) return true; // route doesn't declare @RequiresModule

    const req = context.switchToHttp().getRequest();
    const orgId: string | undefined = req.authUser?.orgId;
    if (!orgId) throw new UnauthorizedException();

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
