import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

// Fourth guard in the chain. A coarser, additive check to PermissionGuard's
// fine-grained one (see the comment there): "does this user have ANY role
// assignment touching this site at all" — org-wide, or scoped to this exact
// site. A no-op when the route has no siteId (nothing to scope). Applies
// only to routes that actually resolve a target site from params/body/query;
// it does not by itself grant any action, it only ever narrows.
@Injectable()
export class SiteScopeGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const siteId: string | undefined = req.params?.siteId ?? req.body?.siteId ?? req.query?.siteId;
    // No siteId at all -> not site-scoped. `site=all` (Milestone 2's
    // consolidated-view query param, docs/Wireframes.html) targets no single
    // site, so there's nothing for a yes/no gate to check here — filtering
    // an "all sites" query down to what the caller can actually see is
    // SiteAccessService's job, in the service layer, not this guard's.
    if (!siteId || siteId === 'all') return true;

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
