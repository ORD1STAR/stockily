import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UseGuards, UseInterceptors } from '@nestjs/common';
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
import { SalesService } from './sales.service';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { UpdateSalesOrderStatusDto } from './dto/update-sales-order-status.dto';
import { InvoiceSalesOrderDto } from './dto/invoice-sales-order.dto';
import { UpsertPartnerProductPriceDto } from './dto/upsert-partner-product-price.dto';

// Guard chain identical to every other product module (docs/Action Plan.md
// §4) — Gestion Ventes requires Invoicing (seeded in
// packages/infra-db/prisma/seed.ts), not Stock: a services-only line with
// no productId is always valid, matching Invoicing's own standalone nature.
@Controller('sales')
@UseGuards(JwtAuthGuard, ModuleEntitlementGuard, PermissionGuard, SiteScopeGuard)
@RequiresModule('sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Post('orders')
  @RequiresPermission('sales', 'sales.order.create')
  @UseInterceptors(AuditInterceptor)
  @Audit('sales_order', 'sales.order.created')
  createOrder(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSalesOrderDto) {
    return this.sales.createSalesOrder(user.orgId, user.userId, dto);
  }

  @Get('orders')
  @RequiresPermission('sales', 'sales.order.read')
  listOrders(
    @CurrentUser() user: AuthenticatedUser,
    @Query('kind') kind?: string,
    @Query('siteId') siteId?: string,
    @Query('customerId') customerId?: string,
  ) {
    return this.sales.listSalesOrders(user.orgId, { kind, siteId, customerId });
  }

  @Get('orders/:id')
  @RequiresPermission('sales', 'sales.order.read')
  getOrder(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.sales.getSalesOrder(user.orgId, id);
  }

  // Handles both cancellation and devis->commande promotion — see
  // UpdateSalesOrderStatusDto's own doc for why these are the only two
  // transitions exposed here.
  @Patch('orders/:id/status')
  @RequiresPermission('sales', 'sales.order.update')
  @UseInterceptors(AuditInterceptor)
  @Audit('sales_order', 'sales.order.status_updated')
  updateOrderStatus(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateSalesOrderStatusDto) {
    return this.sales.updateSalesOrderStatus(user.orgId, user.userId, id, dto);
  }

  // Generates a draft CUSTOMER invoice from (a subset of) a commande's
  // lines — see SalesService.invoiceSalesOrder for why finalization stays
  // on Invoicing's own page rather than happening here.
  @Post('orders/:id/invoice')
  @RequiresPermission('sales', 'sales.invoice.create')
  @UseInterceptors(AuditInterceptor)
  @Audit('sales_order', 'sales.order.invoiced')
  invoiceOrder(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: InvoiceSalesOrderDto) {
    return this.sales.invoiceSalesOrder(user.orgId, user.userId, id, dto);
  }

  // ---------------- Impression ----------------

  @Get('orders/:id/pdf')
  @RequiresPermission('sales', 'sales.order.read')
  async downloadOrderPdf(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Res() res: Response) {
    const pdf = await this.sales.generateOrderPdf(user.orgId, id);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="commande-${id}.pdf"` });
    res.send(pdf);
  }

  @Get('orders/:id/delivery-note')
  @RequiresPermission('sales', 'sales.order.read')
  async downloadDeliveryNotePdf(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Res() res: Response) {
    const pdf = await this.sales.generateDeliveryNotePdf(user.orgId, id);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="bon-livraison-${id}.pdf"` });
    res.send(pdf);
  }

  // ---------------- Negotiated customer pricing ----------------

  @Get('pricing')
  @RequiresPermission('sales', 'sales.pricing.read')
  listPricing(@CurrentUser() user: AuthenticatedUser, @Query('partnerId') partnerId?: string) {
    return this.sales.listPartnerProductPrices(user.orgId, partnerId);
  }

  @Post('pricing')
  @RequiresPermission('sales', 'sales.pricing.write')
  @UseInterceptors(AuditInterceptor)
  @Audit('partner_product_price', 'sales.pricing.upserted')
  upsertPricing(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpsertPartnerProductPriceDto) {
    return this.sales.upsertPartnerProductPrice(user.orgId, dto);
  }

  @Delete('pricing/:id')
  @RequiresPermission('sales', 'sales.pricing.write')
  @UseInterceptors(AuditInterceptor)
  @Audit('partner_product_price', 'sales.pricing.deleted')
  deletePricing(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.sales.deletePartnerProductPrice(user.orgId, id);
  }

  // ---------------- Dashboard ----------------

  @Get('dashboard')
  @RequiresPermission('sales', 'sales.dashboard.read')
  getDashboard(@CurrentUser() user: AuthenticatedUser) {
    return this.sales.getDashboard(user.orgId);
  }
}
