import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { CurrentUser, AuthenticatedUser } from '../tenancy/decorators/current-user.decorator';
import { RequiresModule } from '../tenancy/decorators/requires-module.decorator';
import { RequiresPermission } from '../tenancy/decorators/requires-permission.decorator';
import { JwtAuthGuard } from '../tenancy/guards/jwt-auth.guard';
import { ModuleEntitlementGuard } from '../tenancy/guards/module-entitlement.guard';
import { PermissionGuard } from '../tenancy/guards/permission.guard';
import { SiteScopeGuard } from '../tenancy/guards/site-scope.guard';
import { Audit } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { PurchasingService } from './purchasing.service';
import { CreatePurchaseOrderDto, UpdatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { CreatePurchaseReceiptDto } from './dto/create-purchase-receipt.dto';
import { CreateRfqDto } from './dto/create-rfq.dto';
import { CreateSupplierInvoiceDto } from './dto/create-supplier-invoice.dto';
import { UpdateRfqPricesDto } from './dto/update-rfq-prices.dto';

// Guard chain identical to every other product module (docs/Action Plan.md
// §4) — Purchasing requires Stock (seeded in packages/infra-db/prisma/seed.ts,
// enforced at activation time by ModuleEntitlementGuard the same way Quality
// requires Stock).
@Controller('purchasing')
@UseGuards(JwtAuthGuard, ModuleEntitlementGuard, PermissionGuard, SiteScopeGuard)
@RequiresModule('purchasing')
export class PurchasingController {
  constructor(private readonly purchasing: PurchasingService) {}

  @Post('orders')
  @RequiresPermission('purchasing', 'purchasing.order.create')
  @UseInterceptors(AuditInterceptor)
  @Audit('purchase_order', 'purchasing.order.created')
  createOrder(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePurchaseOrderDto) {
    return this.purchasing.createPurchaseOrder(user.orgId, user.userId, dto);
  }

  @Get('orders')
  @RequiresPermission('purchasing', 'purchasing.order.read')
  listOrders(@CurrentUser() user: AuthenticatedUser, @Query('siteId') siteId?: string) {
    return this.purchasing.listPurchaseOrders(user.orgId, siteId);
  }

  @Get('orders/:id')
  @RequiresPermission('purchasing', 'purchasing.order.read')
  getOrder(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.purchasing.getPurchaseOrder(user.orgId, id);
  }

  // The only status transition exposed here is cancellation — "confirmed"/
  // "partially_received"/"received" are derived automatically from receipts
  // (PurchasingService.updatePurchaseOrderStatus), never set through this
  // endpoint.
  @Patch('orders/:id')
  @RequiresPermission('purchasing', 'purchasing.order.cancel')
  @UseInterceptors(AuditInterceptor)
  @Audit('purchase_order', 'purchasing.order.cancelled')
  updateOrder(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdatePurchaseOrderDto) {
    return this.purchasing.updatePurchaseOrder(user.orgId, id, dto);
  }

  // Accepts a tableau of lines, posts the real IN stock movement per line
  // (plus an optional new lot / quality check exactly like Scan's own
  // Entrée flow) and updates the linked purchase order's received progress
  // — see PurchasingService.receiveGoods for the exact sequencing.
  @Post('receipts')
  @RequiresPermission('purchasing', 'purchasing.receipt.create')
  @UseInterceptors(AuditInterceptor)
  @Audit('purchase_receipt', 'purchasing.receipt.created')
  receiveGoods(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePurchaseReceiptDto) {
    return this.purchasing.receiveGoods(user.orgId, user.userId, dto);
  }

  @Get('receipts')
  @RequiresPermission('purchasing', 'purchasing.receipt.read')
  listReceipts(@CurrentUser() user: AuthenticatedUser, @Query('purchaseOrderId') purchaseOrderId?: string) {
    return this.purchasing.listReceipts(user.orgId, purchaseOrderId);
  }

  @Get('receipts/:id')
  @RequiresPermission('purchasing', 'purchasing.receipt.read')
  getReceipt(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.purchasing.getReceipt(user.orgId, id);
  }

  // ---------------- Facture fournisseur ----------------

  @Post('orders/:id/invoice')
  @RequiresPermission('purchasing', 'purchasing.invoice.create')
  @UseInterceptors(AuditInterceptor)
  @Audit('purchase_order', 'purchasing.order.invoiced')
  createSupplierInvoice(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: CreateSupplierInvoiceDto) {
    return this.purchasing.createSupplierInvoice(user.orgId, id, dto);
  }

  // ---------------- RFQ / comparaison de prix ----------------

  @Post('rfq')
  @RequiresPermission('purchasing', 'purchasing.rfq.create')
  @UseInterceptors(AuditInterceptor)
  @Audit('purchase_order', 'purchasing.rfq.created')
  createRfq(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateRfqDto) {
    return this.purchasing.createRfq(user.orgId, user.userId, dto);
  }

  @Get('rfq/:groupId')
  @RequiresPermission('purchasing', 'purchasing.rfq.create')
  getRfqGroup(@CurrentUser() user: AuthenticatedUser, @Param('groupId') groupId: string) {
    return this.purchasing.getRfqGroup(user.orgId, groupId);
  }

  @Post('rfq/:groupId/award/:purchaseOrderId')
  @RequiresPermission('purchasing', 'purchasing.rfq.award')
  @UseInterceptors(AuditInterceptor)
  @Audit('purchase_order', 'purchasing.rfq.awarded')
  awardRfq(@CurrentUser() user: AuthenticatedUser, @Param('groupId') groupId: string, @Param('purchaseOrderId') purchaseOrderId: string) {
    return this.purchasing.awardRfq(user.orgId, groupId, purchaseOrderId);
  }

  // Records the price one supplier actually quoted for a candidate created
  // via createRfq (which starts every line at unitCost 0) — same
  // rfq.create permission as creating the comparison itself, not a
  // separate action.
  @Patch('rfq/orders/:purchaseOrderId/prices')
  @RequiresPermission('purchasing', 'purchasing.rfq.create')
  @UseInterceptors(AuditInterceptor)
  @Audit('purchase_order', 'purchasing.rfq.prices_updated')
  updateRfqPrices(@CurrentUser() user: AuthenticatedUser, @Param('purchaseOrderId') purchaseOrderId: string, @Body() dto: UpdateRfqPricesDto) {
    return this.purchasing.updateRfqLinePrices(user.orgId, purchaseOrderId, dto);
  }

  // ---------------- Historique de prix ----------------

  @Get('products/:productId/last-price')
  @RequiresPermission('purchasing', 'purchasing.order.read')
  getLastPricePaid(@CurrentUser() user: AuthenticatedUser, @Param('productId') productId: string, @Query('supplierId') supplierId?: string) {
    return this.purchasing.getLastPricePaid(user.orgId, productId, supplierId);
  }

  // ---------------- Dashboard ----------------

  @Get('dashboard')
  @RequiresPermission('purchasing', 'purchasing.dashboard.read')
  getDashboard(@CurrentUser() user: AuthenticatedUser) {
    return this.purchasing.getDashboard(user.orgId);
  }
}
