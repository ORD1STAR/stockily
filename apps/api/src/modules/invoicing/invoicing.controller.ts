import { Body, Controller, Get, Param, Patch, Post, Query, Res, UseGuards, UseInterceptors } from '@nestjs/common';
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
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { CreatePartnerDto } from './dto/create-partner.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { CreateTaxRateDto } from './dto/create-tax-rate.dto';
import { UpdateOrganizationProfileDto } from './dto/update-organization-profile.dto';
import { UpdatePartnerDto } from './dto/update-partner.dto';
import { InvoicingService } from './invoicing.service';

// Every route runs behind the full guard chain (docs/Action Plan.md §4):
// JwtAuthGuard -> ModuleEntitlementGuard -> PermissionGuard -> SiteScopeGuard.
@Controller('invoicing')
@UseGuards(JwtAuthGuard, ModuleEntitlementGuard, PermissionGuard, SiteScopeGuard)
@RequiresModule('invoicing')
export class InvoicingController {
  constructor(private readonly invoicing: InvoicingService) {}

  // ---------------- Partners ----------------

  @Post('partners')
  @RequiresPermission('invoicing', 'invoicing.partner.write')
  @UseInterceptors(AuditInterceptor)
  @Audit('partner', 'invoicing.partner.created')
  createPartner(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePartnerDto) {
    return this.invoicing.createPartner(user.orgId, dto);
  }

  @Get('partners')
  @RequiresPermission('invoicing', 'invoicing.partner.read')
  listPartners(@CurrentUser() user: AuthenticatedUser) {
    return this.invoicing.listPartners(user.orgId);
  }

  @Patch('partners/:id')
  @RequiresPermission('invoicing', 'invoicing.partner.write')
  @UseInterceptors(AuditInterceptor)
  @Audit('partner', 'invoicing.partner.updated')
  updatePartner(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdatePartnerDto) {
    return this.invoicing.updatePartner(user.orgId, id, dto);
  }

  // ---------------- Tax rates ----------------

  @Post('tax-rates')
  @RequiresPermission('invoicing', 'invoicing.taxrate.write')
  @UseInterceptors(AuditInterceptor)
  @Audit('tax_rate', 'invoicing.taxrate.created')
  createTaxRate(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateTaxRateDto) {
    return this.invoicing.createTaxRate(user.orgId, dto);
  }

  @Get('tax-rates')
  @RequiresPermission('invoicing', 'invoicing.taxrate.read')
  listTaxRates(@CurrentUser() user: AuthenticatedUser) {
    return this.invoicing.listTaxRates(user.orgId);
  }

  // ---------------- Business legal profile ----------------

  @Get('organization-profile')
  @RequiresPermission('invoicing', 'invoicing.profile.read')
  getOrganizationProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.invoicing.getOrganizationProfile(user.orgId);
  }

  @Post('organization-profile')
  @RequiresPermission('invoicing', 'invoicing.profile.write')
  @UseInterceptors(AuditInterceptor)
  @Audit('organization', 'invoicing.profile.updated')
  updateOrganizationProfile(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateOrganizationProfileDto) {
    return this.invoicing.updateOrganizationProfile(user.orgId, dto);
  }

  // ---------------- Invoices ----------------

  @Post('invoices')
  @RequiresPermission('invoicing', 'invoicing.invoice.create')
  @UseInterceptors(AuditInterceptor)
  @Audit('invoice', 'invoicing.invoice.created')
  createInvoice(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateInvoiceDto) {
    return this.invoicing.createInvoice(user.orgId, dto);
  }

  @Get('invoices')
  @RequiresPermission('invoicing', 'invoicing.invoice.read')
  listInvoices(@CurrentUser() user: AuthenticatedUser, @Query('status') status?: string) {
    return this.invoicing.listInvoices(user.orgId, { status });
  }

  @Get('invoices/:id')
  @RequiresPermission('invoicing', 'invoicing.invoice.read')
  getInvoice(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.invoicing.getInvoiceDetail(user.orgId, id);
  }

  @Post('invoices/:id/finalize')
  @RequiresPermission('invoicing', 'invoicing.invoice.finalize')
  @UseInterceptors(AuditInterceptor)
  @Audit('invoice', 'invoicing.invoice.finalized')
  finalizeInvoice(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.invoicing.finalizeInvoice(user.orgId, id, user.userId);
  }

  @Post('invoices/:id/void')
  @RequiresPermission('invoicing', 'invoicing.invoice.void')
  @UseInterceptors(AuditInterceptor)
  @Audit('invoice', 'invoicing.invoice.voided')
  voidInvoice(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.invoicing.voidInvoice(user.orgId, id);
  }

  @Post('invoices/:id/payments')
  @RequiresPermission('invoicing', 'invoicing.payment.create')
  @UseInterceptors(AuditInterceptor)
  @Audit('payment', 'invoicing.payment.created')
  recordPayment(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: CreatePaymentDto) {
    return this.invoicing.recordPayment(user.orgId, id, dto);
  }

  @Post('invoices/:id/payments/reset')
  @RequiresPermission('invoicing', 'invoicing.payment.create')
  @UseInterceptors(AuditInterceptor)
  @Audit('payment', 'invoicing.payment.reset')
  resetPayments(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.invoicing.resetPayments(user.orgId, id);
  }

  @Get('invoices/:id/pdf')
  @RequiresPermission('invoicing', 'invoicing.invoice.read')
  async downloadPdf(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Res() res: Response) {
    const pdf = await this.invoicing.generatePdf(user.orgId, id);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="facture-${id}.pdf"` });
    res.send(pdf);
  }

  // ---------------- Reminders ----------------
  // Manually triggered on-demand check (no scheduler wired up this
  // milestone) — a simple overdue check, not the full Phase 2
  // Notifications center. See InvoicingService.runReminderCheck.

  @Post('reminders/run')
  @RequiresPermission('invoicing', 'invoicing.reminder.run')
  runReminderCheck(@CurrentUser() user: AuthenticatedUser) {
    return this.invoicing.runReminderCheck(user.orgId);
  }
}
