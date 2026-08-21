import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

// Fourth guard in the chain. A coarser, additive check to PermissionGuard's
// fine-grained one (see the comment there): "does this user have ANY role
// assignment touching this site at all" — org-wide, or scoped to this exact
// site. A no-op when the route has no siteId (nothing to scope). Applies
// only to routes that actually resolve a target site from params/body; it
// does not by itself grant any action, it only ever narrows.
@Injectable()
export class SiteScopeGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const siteId: string | undefined = req.params?.siteId ?? req.body?.siteId;
    if (!siteId) return true; // route isn't site-scoped

    const userId: string | undefined = req.authUser?.userId;
    if (!userId) throw new UnauthorizedException();

    const hasAccess = await this.prisma.userRole.findFirst({
      where: { userId, OR: [{ siteId: null }, { siteId }] },
    });

    if (!hasAccess) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'site_scope_denied',
        siteId,
        message: 'No role assignment grants access to this site.',
      });
    }
    return true;
  }
}
