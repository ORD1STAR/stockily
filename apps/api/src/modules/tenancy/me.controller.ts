import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { isLocalMode } from '../../local/local-env';
import { getLocalActiveModuleKeys } from '../../local/local-entitlements';
import { CurrentUser, AuthenticatedUser } from './decorators/current-user.decorator';
import { RequiresModule } from './decorators/requires-module.decorator';
import { RequiresPermission } from './decorators/requires-permission.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { ModuleEntitlementGuard } from './guards/module-entitlement.guard';
import { PermissionGuard } from './guards/permission.guard';
import { SiteScopeGuard } from './guards/site-scope.guard';

// Demonstrates the full guard chain end-to-end (docs/Action Plan.md §4),
// not a real product feature. GET /me needs no module entitlement or
// specific permission (every authenticated user can see their own
// identity) — it exists to prove JwtAuthGuard alone works, and as a place
// for the frontend's auth context to confirm a token is valid.
@Controller()
@UseGuards(JwtAuthGuard, ModuleEntitlementGuard, PermissionGuard, SiteScopeGuard)
export class MeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('me')
  async me(@CurrentUser() authUser: AuthenticatedUser) {
    const [user, organization, entitlements, userRoles] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: authUser.userId }, select: { id: true, email: true, username: true, displayName: true, phone: true } }),
      this.prisma.organization.findUniqueOrThrow({ where: { id: authUser.orgId }, select: { id: true, name: true, plan: true } }),
      this.prisma.organizationModuleEntitlement.findMany({
        where: { orgId: authUser.orgId },
        include: { module: { select: { key: true, name: true } } },
      }),
      this.prisma.userRole.findMany({
        where: { userId: authUser.userId },
        include: {
          role: { select: { id: true, name: true, rolePermissions: { select: { action: true } } } },
          site: { select: { id: true, name: true } },
        },
      }),
    ]);

    // Effective permission actions + site scope for the caller, so the web
    // can hide controls a sub-user lacks (the server still enforces via the
    // guard chain — this is cosmetic). A role scoped to no specific site
    // (siteId null) means org-wide, hence siteScope 'all'.
    const permissions = [...new Set(userRoles.flatMap((ur) => ur.role.rolePermissions.map((p) => p.action)))];
    const siteIds = userRoles.map((ur) => ur.site?.id ?? null);
    const siteScope: 'all' | string[] = siteIds.includes(null) ? 'all' : [...new Set(siteIds as string[])];

    let modules = entitlements.map((e) => ({
      module: e.module.key,
      status: e.status,
      trialEndsAt: e.trialEndsAt,
      expiresAt: e.expiresAt,
    }));
    // Desktop app: the signed license decides which modules exist (same source as the guard), so the
    // menus and the access checks always agree — including right after a module is bought online.
    const licensed = isLocalMode() ? getLocalActiveModuleKeys() : null;
    if (licensed) {
      modules = modules.map((m) => (licensed.has(m.module) || !['active', 'trial'].includes(m.status) ? m : { ...m, status: 'expired' }));
      for (const key of licensed) {
        const row = modules.find((m) => m.module === key);
        if (!row) modules.push({ module: key, status: 'active', trialEndsAt: null, expiresAt: null });
        else if (!['active', 'trial'].includes(row.status)) Object.assign(row, { status: 'active', trialEndsAt: null, expiresAt: null });
      }
    }

    return {
      user,
      organization,
      entitlements: modules,
      roles: userRoles.map((ur) => ({ role: ur.role.name, site: ur.site?.name ?? null })),
      permissions,
      siteScope,
    };
  }

  // Temporary demonstration route only — proves ModuleEntitlementGuard +
  // PermissionGuard + SiteScopeGuard reject/accept correctly for a
  // site-scoped action, since GET /me above never exercises them (no
  // module/permission/siteId on that route). Real Sites-module endpoints
  // in a later milestone replace this; remove it then.
  @Get('demo/stock-access/:siteId')
  @RequiresModule('stock')
  @RequiresPermission('stock', 'stock.product.read')
  demoStockAccess(@Param('siteId') siteId: string, @CurrentUser() authUser: AuthenticatedUser) {
    return { ok: true, siteId, orgId: authUser.orgId, message: 'Stock entitlement + permission + site scope all passed.' };
  }
}
