import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser, AuthenticatedUser } from '../tenancy/decorators/current-user.decorator';
import { RequiresModule } from '../tenancy/decorators/requires-module.decorator';
import { RequiresPermission } from '../tenancy/decorators/requires-permission.decorator';
import { JwtAuthGuard } from '../tenancy/guards/jwt-auth.guard';
import { ModuleEntitlementGuard } from '../tenancy/guards/module-entitlement.guard';
import { PermissionGuard } from '../tenancy/guards/permission.guard';
import { SiteScopeGuard } from '../tenancy/guards/site-scope.guard';
import { Granularity, StatsService } from './stats.service';

// Statistiques — its own module, independent of Invoicing: read-only
// figures across whichever of stock/achats/ventes/factures/caisse happen
// to be active, degrading to empty sections for the rest. Previously had
// no @RequiresModule at all (only the frontend nav tile pretended it
// needed 'invoicing'), so entitlement was never actually enforced here.
@Controller('stats')
@UseGuards(JwtAuthGuard, ModuleEntitlementGuard, PermissionGuard, SiteScopeGuard)
@RequiresModule('stats')
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @Get()
  @RequiresPermission('stats', 'stats.overview.read')
  overview(
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('granularity') granularity = 'day',
    @Query('siteId') siteId?: string,
    @Query('compareFrom') compareFrom?: string,
    @Query('compareTo') compareTo?: string,
  ) {
    if (!['day', 'week', 'month', 'year'].includes(granularity)) throw new BadRequestException('Intervalle inconnu.');
    return this.stats.overview(user.orgId, from, to, granularity as Granularity, siteId || undefined, compareFrom && compareTo ? { from: compareFrom, to: compareTo } : undefined);
  }
}
