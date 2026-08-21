import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
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
      this.prisma.user.findUniqueOrThrow({ where: { id: authUser.userId }, select: { id: true, email: true } }),
      this.prisma.organization.findUniqueOrThrow({ where: { id: authUser.orgId }, select: { id: true, name: true, plan: true } }),
      this.prisma.organizationModuleEntitlement.findMany({
        where: { orgId: authUser.orgId },
        include: { module: { select: { key: true, name: true } } },
      }),
      this.prisma.userRole.findMany({
        where: { userId: authUser.userId },
        include: { role: { select: { id: true, name: true } }, site: { select: { id: true, name: true } } },
      }),
    ]);

    return {
      user,
      organization,
      entitlements: entitlements.map((e) => ({
        module: e.module.key,
        status: e.status,
        trialEndsAt: e.trialEndsAt,
      })),
      roles: userRoles.map((ur) => ({ role: ur.role.name, site: ur.site?.name ?? null })),
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
