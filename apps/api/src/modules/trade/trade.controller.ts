import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { TradePrintService } from './trade-print.service';
import { CurrentUser, AuthenticatedUser } from '../tenancy/decorators/current-user.decorator';
import { RequiresModule } from '../tenancy/decorators/requires-module.decorator';
import { RequiresPermission } from '../tenancy/decorators/requires-permission.decorator';
import { JwtAuthGuard } from '../tenancy/guards/jwt-auth.guard';
import { ModuleEntitlementGuard } from '../tenancy/guards/module-entitlement.guard';
import { PermissionGuard } from '../tenancy/guards/permission.guard';
import { SiteScopeGuard } from '../tenancy/guards/site-scope.guard';
import { Audit } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { TradeService } from './trade.service';
import { CreatePartnerPaymentDto, CreateTradeDocumentDto, InvoiceDocumentsDto } from './dto/trade.dto';

// Bons (livraison, retours) and partner accounts. Module and permission are
// declared per route — the entitlement/permission guards read handler-level
// metadata — and reuse the existing Ventes / Achats / Facturation actions,
// so every existing role keeps exactly the access it already had.
@Controller('trade')
@UseGuards(JwtAuthGuard, ModuleEntitlementGuard, PermissionGuard, SiteScopeGuard)
export class TradeController {
  constructor(
    private readonly trade: TradeService,
    private readonly print: TradePrintService,
  ) {}

  private sendPdf(res: Response, pdf: Buffer, name: string) {
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${name}.pdf"` });
    res.send(pdf);
  }

  @Get('documents/sales/:id/pdf')
  @RequiresModule('sales')
  @RequiresPermission('sales', 'sales.order.read')
  async salesDocumentPdf(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Res() res: Response) {
    this.sendPdf(res, await this.print.documentPdf(user.orgId, id, ['delivery_note', 'customer_return']), id);
  }

  @Get('documents/purchases/:id/pdf')
  @RequiresModule('purchasing')
  @RequiresPermission('purchasing', 'purchasing.receipt.read')
  async purchaseDocumentPdf(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Res() res: Response) {
    this.sendPdf(res, await this.print.documentPdf(user.orgId, id, ['supplier_return']), id);
  }

  @Get('partners/:id/unpaid')
  @RequiresModule('invoicing')
  @RequiresPermission('invoicing', 'invoicing.partner.read')
  unpaid(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Query('side') side?: string) {
    return this.print.unpaid(user.orgId, id, side === 'supplier' ? 'supplier' : 'customer');
  }

  @Get('partners/:id/unpaid/pdf')
  @RequiresModule('invoicing')
  @RequiresPermission('invoicing', 'invoicing.partner.read')
  async unpaidPdf(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Res() res: Response, @Query('side') side?: string) {
    this.sendPdf(res, await this.print.unpaidPdf(user.orgId, id, side === 'supplier' ? 'supplier' : 'customer'), `etat-${id}`);
  }

  @Post('documents/delivery-notes')
  @RequiresModule('sales')
  @RequiresPermission('sales', 'sales.order.update')
  @UseInterceptors(AuditInterceptor)
  @Audit('trade_document', 'trade.delivery_note.created')
  createDeliveryNote(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateTradeDocumentDto) {
    return this.create(user, dto, 'delivery_note');
  }

  @Post('documents/customer-returns')
  @RequiresModule('sales')
  @RequiresPermission('sales', 'sales.order.update')
  @UseInterceptors(AuditInterceptor)
  @Audit('trade_document', 'trade.customer_return.created')
  createCustomerReturn(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateTradeDocumentDto) {
    return this.create(user, dto, 'customer_return');
  }

  @Post('documents/supplier-returns')
  @RequiresModule('purchasing')
  @RequiresPermission('purchasing', 'purchasing.receipt.create')
  @UseInterceptors(AuditInterceptor)
  @Audit('trade_document', 'trade.supplier_return.created')
  createSupplierReturn(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateTradeDocumentDto) {
    return this.create(user, dto, 'supplier_return');
  }

  @Get('documents/sales')
  @RequiresModule('sales')
  @RequiresPermission('sales', 'sales.order.read')
  listSalesDocuments(
    @CurrentUser() user: AuthenticatedUser,
    @Query('type') type?: string,
    @Query('partnerId') partnerId?: string,
    @Query('salesOrderId') salesOrderId?: string,
  ) {
    if (type && type !== 'delivery_note' && type !== 'customer_return') throw new BadRequestException('Type inconnu.');
    return this.trade.listDocuments(user.orgId, { type: type ?? undefined, partnerId, salesOrderId }).then((docs) => docs.filter((d) => d.type !== 'supplier_return'));
  }

  @Get('documents/purchases')
  @RequiresModule('purchasing')
  @RequiresPermission('purchasing', 'purchasing.receipt.read')
  listPurchaseDocuments(@CurrentUser() user: AuthenticatedUser, @Query('partnerId') partnerId?: string) {
    return this.trade.listDocuments(user.orgId, { type: 'supplier_return', partnerId });
  }

  @Get('documents/sales/:id')
  @RequiresModule('sales')
  @RequiresPermission('sales', 'sales.order.read')
  getSalesDocument(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.trade.getDocument(user.orgId, id, ['delivery_note', 'customer_return']);
  }

  @Get('documents/purchases/:id')
  @RequiresModule('purchasing')
  @RequiresPermission('purchasing', 'purchasing.receipt.read')
  getPurchaseDocument(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.trade.getDocument(user.orgId, id, ['supplier_return']);
  }

  @Post('documents/sales/:id/cancel')
  @RequiresModule('sales')
  @RequiresPermission('sales', 'sales.order.cancel')
  @UseInterceptors(AuditInterceptor)
  @Audit('trade_document', 'trade.document.cancelled')
  cancelSalesDocument(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.trade.cancelDocument(user.orgId, user.userId, id, ['delivery_note', 'customer_return']);
  }

  @Post('documents/purchases/:id/cancel')
  @RequiresModule('purchasing')
  @RequiresPermission('purchasing', 'purchasing.order.cancel')
  @UseInterceptors(AuditInterceptor)
  @Audit('trade_document', 'trade.document.cancelled')
  cancelPurchaseDocument(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.trade.cancelDocument(user.orgId, user.userId, id, ['supplier_return']);
  }

  @Post('documents/invoice')
  @RequiresModule('invoicing')
  @RequiresPermission('invoicing', 'invoicing.invoice.create')
  @UseInterceptors(AuditInterceptor)
  @Audit('invoice', 'trade.delivery_notes.invoiced')
  invoiceDeliveryNotes(@CurrentUser() user: AuthenticatedUser, @Body() dto: InvoiceDocumentsDto) {
    return this.trade.invoiceDeliveryNotes(user.orgId, user.userId, dto.documentIds);
  }

  @Post('payments')
  @RequiresModule('invoicing')
  @RequiresPermission('invoicing', 'invoicing.payment.create')
  @UseInterceptors(AuditInterceptor)
  @Audit('partner_payment', 'trade.payment.created')
  createPayment(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePartnerPaymentDto) {
    return this.trade.createPayment(user.orgId, user.userId, dto);
  }

  @Delete('payments/:id')
  @RequiresModule('invoicing')
  @RequiresPermission('invoicing', 'invoicing.payment.create')
  @UseInterceptors(AuditInterceptor)
  @Audit('partner_payment', 'trade.payment.cancelled')
  cancelPayment(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.trade.cancelPayment(user.orgId, id);
  }

  @Get('partners/:id/statement')
  @RequiresModule('invoicing')
  @RequiresPermission('invoicing', 'invoicing.partner.read')
  statement(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.trade.statement(user.orgId, id);
  }

  private create(user: AuthenticatedUser, dto: CreateTradeDocumentDto, type: CreateTradeDocumentDto['type']) {
    if (dto.type !== type) throw new BadRequestException('Type de document incohérent avec la route.');
    return this.trade.createDocument(user.orgId, user.userId, dto);
  }
}
