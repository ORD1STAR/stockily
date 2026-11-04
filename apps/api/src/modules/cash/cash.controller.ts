import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { CurrentUser, AuthenticatedUser } from '../tenancy/decorators/current-user.decorator';
import { RequiresModule } from '../tenancy/decorators/requires-module.decorator';
import { RequiresPermission } from '../tenancy/decorators/requires-permission.decorator';
import { JwtAuthGuard } from '../tenancy/guards/jwt-auth.guard';
import { ModuleEntitlementGuard } from '../tenancy/guards/module-entitlement.guard';
import { PermissionGuard } from '../tenancy/guards/permission.guard';
import { SiteScopeGuard } from '../tenancy/guards/site-scope.guard';
import { Audit } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { CashService } from './cash.service';
import { CreateCashEntryDto } from './cash.dto';

// Caisse — its own module, independent of Invoicing: a CashEntry (manual
// encaissement/décaissement) needs nothing else active. It additionally
// surfaces payments recorded by Invoicing/Achats/Ventes/Comptoirs when
// those happen to be active too (CashService.collect), but never requires
// them — journal()/openDocuments() just return fewer rows if they're off.
@Controller('cash')
@UseGuards(JwtAuthGuard, ModuleEntitlementGuard, PermissionGuard, SiteScopeGuard)
@RequiresModule('cash')
export class CashController {
  constructor(private readonly cash: CashService) {}

  @Get()
  @RequiresPermission('cash', 'cash.journal.read')
  journal(@CurrentUser() user: AuthenticatedUser, @Query('from') from: string, @Query('to') to: string, @Query('siteId') siteId?: string) {
    if (!from || !to || Number.isNaN(new Date(from).getTime()) || Number.isNaN(new Date(to).getTime())) throw new BadRequestException('Période invalide.');
    return this.cash.journal(user.orgId, from, to, siteId || undefined);
  }

  @Get('open-documents')
  @RequiresPermission('cash', 'cash.journal.read')
  openDocuments(@CurrentUser() user: AuthenticatedUser, @Query('partnerId') partnerId: string, @Query('direction') direction: string) {
    if (!partnerId) throw new BadRequestException('Partenaire requis.');
    return this.cash.openDocuments(user.orgId, partnerId, direction === 'out' ? 'out' : 'in');
  }

  @Post('entries')
  @RequiresPermission('cash', 'cash.entry.write')
  @UseInterceptors(AuditInterceptor)
  @Audit('cash_entry', 'cash.entry.created')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCashEntryDto) {
    return this.cash.create(user.orgId, user.userId, dto);
  }

  @Delete('entries/:source/:id')
  @RequiresPermission('cash', 'cash.entry.write')
  @UseInterceptors(AuditInterceptor)
  @Audit('cash_entry', 'cash.entry.cancelled')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('source') source: string, @Param('id') id: string) {
    if (source !== 'manual' && source !== 'payment') throw new BadRequestException('Ce mouvement ne peut pas être annulé ici.');
    return this.cash.cancel(user.orgId, source, id);
  }
}
