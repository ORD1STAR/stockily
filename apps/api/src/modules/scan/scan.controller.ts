import { Body, Controller, Get, Param, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { CurrentUser, AuthenticatedUser } from '../tenancy/decorators/current-user.decorator';
import { RequiresModule } from '../tenancy/decorators/requires-module.decorator';
import { RequiresPermission } from '../tenancy/decorators/requires-permission.decorator';
import { JwtAuthGuard } from '../tenancy/guards/jwt-auth.guard';
import { ModuleEntitlementGuard } from '../tenancy/guards/module-entitlement.guard';
import { PermissionGuard } from '../tenancy/guards/permission.guard';
import { SiteScopeGuard } from '../tenancy/guards/site-scope.guard';
import { Audit } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { GenerateLabelDto } from './dto/generate-label.dto';
import { ScanService } from './scan.service';

@Controller('scan')
@UseGuards(JwtAuthGuard, ModuleEntitlementGuard, PermissionGuard, SiteScopeGuard)
@RequiresModule('scan')
export class ScanController {
  constructor(private readonly scan: ScanService) {}

  @Post('labels')
  @RequiresPermission('scan', 'scan.label.generate')
  @UseInterceptors(AuditInterceptor)
  @Audit('barcode_label', 'scan.label.generated')
  generateLabel(@CurrentUser() user: AuthenticatedUser, @Body() dto: GenerateLabelDto) {
    return this.scan.generateLabel(user.orgId, dto);
  }

  @Get('labels')
  @RequiresPermission('scan', 'scan.label.read')
  listLabels(@CurrentUser() user: AuthenticatedUser, @Query('productId') productId?: string) {
    return this.scan.listLabels(user.orgId, productId);
  }

  @Post('labels/:id/print')
  @RequiresPermission('scan', 'scan.label.print')
  @UseInterceptors(AuditInterceptor)
  @Audit('barcode_label', 'scan.label.printed')
  recordPrint(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.scan.recordPrint(user.orgId, id);
  }

  @Get('resolve/:code')
  @RequiresPermission('scan', 'scan.resolve.read')
  resolveCode(@CurrentUser() user: AuthenticatedUser, @Param('code') code: string, @Query('siteId') siteId?: string) {
    return this.scan.resolveCode(user.orgId, code, siteId);
  }
}
