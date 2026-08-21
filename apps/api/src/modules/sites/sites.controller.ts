import { Body, Controller, Get, Param, Patch, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { CurrentUser, AuthenticatedUser } from '../tenancy/decorators/current-user.decorator';
import { RequiresModule } from '../tenancy/decorators/requires-module.decorator';
import { RequiresPermission } from '../tenancy/decorators/requires-permission.decorator';
import { JwtAuthGuard } from '../tenancy/guards/jwt-auth.guard';
import { ModuleEntitlementGuard } from '../tenancy/guards/module-entitlement.guard';
import { PermissionGuard } from '../tenancy/guards/permission.guard';
import { SiteScopeGuard } from '../tenancy/guards/site-scope.guard';
import { Audit } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { SitesService } from './sites.service';
import { CreateSiteDto } from './dto/create-site.dto';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { UpdateTransferDto } from './dto/update-transfer.dto';

@Controller('sites')
@UseGuards(JwtAuthGuard, ModuleEntitlementGuard, PermissionGuard, SiteScopeGuard)
@RequiresModule('sites')
export class SitesController {
  constructor(private readonly sites: SitesService) {}

  @Post()
  @RequiresPermission('sites', 'sites.site.write')
  @UseInterceptors(AuditInterceptor)
  @Audit('site', 'sites.site.created')
  createSite(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSiteDto) {
    return this.sites.createSite(user.orgId, dto);
  }

  @Get()
  @RequiresPermission('sites', 'sites.site.read')
  listSites(@CurrentUser() user: AuthenticatedUser) {
    return this.sites.listSites(user.orgId);
  }

  @Post('transfers')
  @RequiresPermission('sites', 'sites.transfer.create')
  @UseInterceptors(AuditInterceptor)
  @Audit('stock_transfer', 'sites.transfer.created')
  createTransfer(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateTransferDto) {
    return this.sites.createTransfer(user.orgId, user.userId, dto);
  }

  @Get('transfers')
  @RequiresPermission('sites', 'sites.transfer.read')
  listTransfers(@CurrentUser() user: AuthenticatedUser) {
    return this.sites.listTransfers(user.orgId);
  }

  @Patch('transfers/:id')
  @RequiresPermission('sites', 'sites.transfer.update')
  @UseInterceptors(AuditInterceptor)
  @Audit('stock_transfer', 'sites.transfer.updated')
  updateTransfer(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateTransferDto) {
    return this.sites.updateTransfer(user.orgId, id, dto);
  }
}
