import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Resolves which sites a user can see data for — used by list/consolidated
 * endpoints (e.g. `GET /stock/products?site=all`) where the guard chain
 * alone can't express "filter rows to what this user is allowed to see"
 * (that's a query-time concern, not a yes/no gate). `SiteScopeGuard`/
 * `PermissionGuard` still gate a *specific* siteId; this service is what a
 * service layer calls once past the guards, to know how to filter an
 * "all sites" query for a user who isn't actually org-wide.
 */
@Injectable()
export class SiteAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Returns `'all'` for an org-wide role assignment, or the specific list of siteIds the user has a role at. */
  async getAccessibleSiteIds(userId: string, orgId: string): Promise<'all' | string[]> {
    const userRoles = await this.prisma.userRole.findMany({ where: { userId }, select: { siteId: true } });
    if (userRoles.some((ur) => ur.siteId === null)) return 'all';

    const siteIds = userRoles.map((ur) => ur.siteId).filter((id): id is string => id !== null);
    if (siteIds.length === 0) return [];

    // Defensive: a siteId on a UserRole always belongs to the same org (it's
    // only ever set from a site picker scoped to the caller's own org), but
    // this filter costs nothing and prevents a cross-org leak if that
    // invariant is ever violated upstream.
    const ownSites = await this.prisma.site.findMany({ where: { id: { in: siteIds }, orgId }, select: { id: true } });
    return ownSites.map((s) => s.id);
  }
}
