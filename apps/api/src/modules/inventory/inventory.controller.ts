import { Body, Controller, Get, Param, Post, Put, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser, AuthenticatedUser } from '../tenancy/decorators/current-user.decorator';
import { RequiresModule } from '../tenancy/decorators/requires-module.decorator';
import { RequiresPermission } from '../tenancy/decorators/requires-permission.decorator';
import { JwtAuthGuard } from '../tenancy/guards/jwt-auth.guard';
import { ModuleEntitlementGuard } from '../tenancy/guards/module-entitlement.guard';
import { PermissionGuard } from '../tenancy/guards/permission.guard';
import { SiteScopeGuard } from '../tenancy/guards/site-scope.guard';
import { Audit } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { InventoryService } from './inventory.service';
import { CreateInventoryCountDto, InventorySettingsDto, UpdateCountedLinesDto, ValidateInventoryDto } from './dto/inventory.dto';

// Inventaires — part of the Stock module. Counting/validating reuses the
// stock movement permission (a validated inventory writes adjustments).
@Controller('inventory')
@UseGuards(JwtAuthGuard, ModuleEntitlementGuard, PermissionGuard, SiteScopeGuard)
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get('reminder')
  @RequiresModule('stock')
  @RequiresPermission('stock', 'stock.product.read')
  reminder(@CurrentUser() user: AuthenticatedUser) {
    return this.inventory.reminderStatus(user.orgId);
  }

  @Put('settings')
  @RequiresModule('stock')
  @RequiresPermission('stock', 'stock.movement.create')
  @UseInterceptors(AuditInterceptor)
  @Audit('organization', 'inventory.settings.updated')
  settings(@CurrentUser() user: AuthenticatedUser, @Body() dto: InventorySettingsDto) {
    return this.inventory.updateSettings(user.orgId, dto.inventoryReminder);
  }

  @Get('counts')
  @RequiresModule('stock')
  @RequiresPermission('stock', 'stock.product.read')
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.inventory.list(user.orgId);
  }

  @Post('counts')
  @RequiresModule('stock')
  @RequiresPermission('stock', 'stock.movement.create')
  @UseInterceptors(AuditInterceptor)
  @Audit('inventory_count', 'inventory.count.created')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateInventoryCountDto) {
    return this.inventory.create(user.orgId, user.userId, dto);
  }

  @Get('counts/:id')
  @RequiresModule('stock')
  @RequiresPermission('stock', 'stock.product.read')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.inventory.get(user.orgId, id);
  }

  @Put('counts/:id/lines')
  @RequiresModule('stock')
  @RequiresPermission('stock', 'stock.movement.create')
  updateLines(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateCountedLinesDto) {
    return this.inventory.updateLines(user.orgId, id, dto);
  }

  @Post('counts/:id/validate')
  @RequiresModule('stock')
  @RequiresPermission('stock', 'stock.movement.create')
  @UseInterceptors(AuditInterceptor)
  @Audit('inventory_count', 'inventory.count.validated')
  validate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: ValidateInventoryDto) {
    return this.inventory.validate(user.orgId, user.userId, id, dto);
  }

  @Post('counts/:id/cancel')
  @RequiresModule('stock')
  @RequiresPermission('stock', 'stock.movement.create')
  @UseInterceptors(AuditInterceptor)
  @Audit('inventory_count', 'inventory.count.cancelled')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.inventory.cancel(user.orgId, id);
  }

  @Get('counts/:id/pdf')
  @RequiresModule('stock')
  @RequiresPermission('stock', 'stock.product.read')
  async pdf(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Res() res: Response) {
    const pdf = await this.inventory.generatePdf(user.orgId, id);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="inventaire-${id}.pdf"` });
    res.send(pdf);
  }
}
