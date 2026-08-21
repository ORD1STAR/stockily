import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../../prisma/prisma.service';
import { REQUIRES_PERMISSION_KEY, RequiredPermission } from '../decorators/requires-permission.decorator';

// Third guard in the chain. Resolves user -> user_roles (site-scoped or
// org-wide) -> role_permissions(module, action) as ONE combined query
// (docs/Action Plan.md §2), not as two independent checks. That combination
// matters: if this were decoupled from site-scoping (left entirely to
// SiteScopeGuard), a user with an org-wide role that does NOT grant the
// action, plus an unrelated role scoped to a *different* site that DOES
// grant it, could pass two separately-unsound checks that shouldn't combine
// to an authorization. SiteScopeGuard, which runs after this, is a coarser
// "does this user have any relationship to this site at all" check — a
// different, additive question, not a re-check of the same one.
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.get<RequiredPermission | undefined>(
      REQUIRES_PERMISSION_KEY,
      context.getHandler(),
    );
    if (!required) return true;

    const req = context.switchToHttp().getRequest();
    const userId: string | undefined = req.authUser?.userId;
    if (!userId) throw new UnauthorizedException();

    const module = await this.prisma.module.findUnique({ where: { key: required.moduleKey } });
    if (!module) throw new NotFoundException(`Unknown module: ${required.moduleKey}`);

    const rawSiteId: string | undefined = req.params?.siteId ?? req.body?.siteId ?? req.query?.siteId;

    // Three distinct cases, not two — conflating the last two would either
    // wrongly deny a site-scoped-only user on ordinary non-site-scoped
    // routes, or wrongly grant an all-sites request the same strictness as a
    // single concrete site:
    //  - no siteId at all (route has no site dimension, e.g. GET /stock/categories):
    //    unchanged from Milestone 1 — org-wide roles only.
    //  - a concrete siteId: org-wide OR that exact site (unchanged).
    //  - `site=all` (Milestone 2's consolidated-view query param): the
    //    permission check itself should pass for ANY of the user's roles
    //    regardless of site — a site-scoped-only user (e.g. Opérateur
    //    Entrepôt at one site) does have `stock.product.read`, just not for
    //    every site. This guard only answers "is the action ever permitted
    //    for this user"; SiteAccessService (service layer) is what actually
    //    restricts which sites' rows an all-sites request returns to them.
    const roleWhere =
      rawSiteId === 'all'
        ? { userId }
        : { userId, OR: rawSiteId ? [{ siteId: null }, { siteId: rawSiteId }] : [{ siteId: null }] };

    const userRoles = await this.prisma.userRole.findMany({ where: roleWhere, select: { roleId: true } });
    if (userRoles.length === 0) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'permission_denied',
        action: required.action,
        message: 'No applicable role for this site.',
      });
    }

    const permission = await this.prisma.rolePermission.findFirst({
      where: {
        roleId: { in: userRoles.map((ur) => ur.roleId) },
        moduleId: module.id,
        action: required.action,
      },
    });
    if (!permission) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'permission_denied',
        action: required.action,
        message: `Missing permission: ${required.action}`,
      });
    }

    return true;
  }
}
