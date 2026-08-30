import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { setTenantOnTransaction } from '@org/infra-db';
import { PrismaService } from '../../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { InvoicingService } from '../invoicing/invoicing.service';
import { DocumentPdfService, formatMoney } from '../shared-pdf/document-pdf.service';
import { CreateSalesOrderDto, CreateSalesOrderLineDto } from './dto/create-sales-order.dto';
import { UpdateSalesOrderStatusDto } from './dto/update-sales-order-status.dto';
import { InvoiceSalesOrderDto } from './dto/invoice-sales-order.dto';
import { UpsertPartnerProductPriceDto } from './dto/upsert-partner-product-price.dto';

// Prisma Decimal fields serialize as strings over JSON — same fix-at-the-
// boundary convention as PurchasingService (see that file's own comment for
// the real bug this once caused, found live in Chrome).
function serializeOrderLine<T extends { quantityOrdered: unknown; quantityInvoiced: unknown; unitPrice: unknown; discountPercent?: unknown }>(l: T) {
  return {
    ...l,
    quantityOrdered: Number(l.quantityOrdered),
    quantityInvoiced: Number(l.quantityInvoiced),
    unitPrice: Number(l.unitPrice),
    discountPercent: l.discountPercent != null ? Number(l.discountPercent) : null,
  };
}
function serializeOrder<T extends { lines: unknown[] }>(o: T) {
  return { ...o, lines: (o.lines as Parameters<typeof serializeOrderLine>[0][]).map(serializeOrderLine) };
}

// Thin NestJS orchestration layer, same shape as PurchasingService — the
// customer-side mirror of Achats. No @org/domain-sales package for the same
// reason Purchasing has none: there's no framework-agnostic business rule
// here that isn't already owned by StockService (reservation) or
// InvoicingService (the actual facture) — this module's job is genuinely
// just orchestration plus its own tables' CRUD.
const ORDER_STATUS_LABEL_FR: Record<string, string> = {
  draft: 'Brouillon',
  sent: 'Envoyé',
  accepted: 'Accepté',
  expired: 'Expiré',
  confirmed: 'Confirmée',
  partially_invoiced: 'Partiellement facturée',
  invoiced: 'Facturée',
  cancelled: 'Annulé',
};

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly invoicing: InvoicingService,
    private readonly pdf: DocumentPdfService,
  ) {}

  // ---------------- Sales orders (devis + commande) ----------------

  async createSalesOrder(orgId: string, performedBy: string, dto: CreateSalesOrderDto) {
    const customer = await this.prisma.partner.findFirst({ where: { id: dto.customerId, orgId } });
    if (!customer) throw new NotFoundException(`Unknown customer: ${dto.customerId}`);
    if (!customer.isCustomer) throw new BadRequestException(`Partner ${customer.name} is not flagged as a customer.`);
    const site = await this.prisma.site.findFirst({ where: { id: dto.siteId, orgId } });
    if (!site) throw new NotFoundException(`Unknown site: ${dto.siteId}`);

    const resolvedLines = await this.resolveLinePrices(orgId, dto.customerId, dto.lines);

    return this.prisma.$transaction(async (tx) => {
      // Milestone 8 (RLS) — required first statement, same reasoning as
      // every other interactive $transaction in this codebase.
      await setTenantOnTransaction(tx, orgId);

      const number = await this.assignNumber(tx, orgId, dto.kind);

      const order = await tx.salesOrder.create({
        data: {
          orgId,
          siteId: dto.siteId,
          customerId: dto.customerId,
          kind: dto.kind,
          number,
          // A devis starts life "draft" (can still be edited/sent/rejected);
          // a commande is confirmed the moment it's created — no separate
          // approval step in this scope, same simplification Achats' own
          // BC creation already makes.
          status: dto.kind === 'quote' ? 'draft' : 'confirmed',
          expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : null,
          notes: dto.notes ?? null,
          createdBy: performedBy,
          lines: {
            create: resolvedLines.map((l) => ({
              productId: l.productId ?? null,
              description: l.description,
              quantityOrdered: l.quantity,
              unitPrice: l.unitPrice,
              discountPercent: l.discountPercent ?? null,
              taxRateId: l.taxRateId ?? null,
            })),
          },
        },
        include: { lines: true, customer: true, site: true },
      });

      // Only a commande reserves stock — a devis is a non-binding proposal.
      // Reserving every line inside this same transaction means a shortage
      // on any one line (acknowledgeShortage not set) rolls back the whole
      // order — nothing partially created, nothing partially reserved.
      if (dto.kind === 'order') {
        for (const line of order.lines) {
          if (!line.productId) continue;
          await this.stock.reserveInTransaction(tx, {
            orgId,
            productId: line.productId,
            siteId: dto.siteId,
            quantity: Number(line.quantityOrdered),
            allowBackorder: dto.acknowledgeShortage === true,
            performedBy,
          });
        }
      }

      return serializeOrder(order);
    });
  }

  async listSalesOrders(orgId: string, filters: { kind?: string; siteId?: string; customerId?: string }) {
    const orders = await this.prisma.salesOrder.findMany({
      where: {
        orgId,
        ...(filters.kind ? { kind: filters.kind } : {}),
        ...(filters.siteId ? { siteId: filters.siteId } : {}),
        ...(filters.customerId ? { customerId: filters.customerId } : {}),
      },
      include: { customer: true, site: true, lines: { include: { product: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return orders.map(serializeOrder);
  }

  async getSalesOrder(orgId: string, id: string) {
    const order = await this.prisma.salesOrder.findFirst({
      where: { id, orgId },
      include: {
        customer: true,
        site: true,
        lines: { include: { product: true, taxRate: true } },
        invoices: { include: { lines: true } },
      },
    });
    if (!order) throw new NotFoundException(`Unknown sales order: ${id}`);
    return serializeOrder(order);
  }

  async updateSalesOrderStatus(orgId: string, performedBy: string, id: string, dto: UpdateSalesOrderStatusDto) {
    const order = await this.prisma.salesOrder.findFirst({ where: { id, orgId }, include: { lines: true } });
    if (!order) throw new NotFoundException(`Unknown sales order: ${id}`);

    if (dto.action === 'cancelled') {
      if (order.kind === 'order' && order.lines.some((l) => Number(l.quantityInvoiced) > 0)) {
        throw new BadRequestException('Cannot cancel a commande that already has invoiced quantity on it.');
      }
      if (order.status === 'invoiced' || order.status === 'cancelled') {
        throw new BadRequestException(`Cannot cancel a sales order already ${order.status}.`);
      }

      return this.prisma.$transaction(async (tx) => {
        await setTenantOnTransaction(tx, orgId);
        // Release whatever a confirmed commande was still holding reserved
        // — a devis (never reserved anything) skips this, nothing to
        // release.
        if (order.kind === 'order') {
          for (const line of order.lines) {
            if (!line.productId) continue;
            const remaining = Number(line.quantityOrdered) - Number(line.quantityInvoiced);
            if (remaining > 0) {
              await this.stock.releaseInTransaction(tx, { orgId, productId: line.productId, siteId: order.siteId, quantity: remaining, performedBy });
            }
          }
        }
        const updated = await tx.salesOrder.update({
          where: { id },
          data: { status: 'cancelled' },
          include: { lines: true, customer: true, site: true },
        });
        return serializeOrder(updated);
      });
    }

    // dto.action === 'promote' — devis -> commande
    if (order.kind !== 'quote') {
      throw new BadRequestException('Only a devis can be promoted to a commande.');
    }
    if (order.status === 'cancelled') {
      throw new BadRequestException('Cannot promote a cancelled devis.');
    }

    return this.prisma.$transaction(async (tx) => {
      await setTenantOnTransaction(tx, orgId);
      const number = await this.assignNumber(tx, orgId, 'order');

      const promoted = await tx.salesOrder.update({
        where: { id },
        data: { kind: 'order', status: 'confirmed', promotedFromQuoteNumber: order.number, number },
        include: { lines: true, customer: true, site: true },
      });

      // A promoted devis reserves stock for the first time here — it never
      // did as a quote. Same shortage contract as creating a commande
      // directly.
      for (const line of promoted.lines) {
        if (!line.productId) continue;
        await this.stock.reserveInTransaction(tx, {
          orgId,
          productId: line.productId,
          siteId: order.siteId,
          quantity: Number(line.quantityOrdered),
          allowBackorder: dto.acknowledgeShortage === true,
          performedBy,
        });
      }

      return serializeOrder(promoted);
    });
  }

  // ---------------- Invoicing (facture client from a commande) ----------------

  async invoiceSalesOrder(orgId: string, performedBy: string, salesOrderId: string, dto: InvoiceSalesOrderDto) {
    const order = await this.prisma.salesOrder.findFirst({
      where: { id: salesOrderId, orgId },
      include: { lines: { include: { product: true, taxRate: true } } },
    });
    if (!order) throw new NotFoundException(`Unknown sales order: ${salesOrderId}`);
    if (order.kind !== 'order') throw new BadRequestException('Only a commande can be invoiced — promote the devis first.');
    if (order.status === 'cancelled') throw new BadRequestException('Cannot invoice a cancelled commande.');

    const linesByLineId = new Map(order.lines.map((l) => [l.id, l]));
    const invoiceLines = dto.lines.map((requested) => {
      const line = linesByLineId.get(requested.salesOrderLineId);
      if (!line) throw new NotFoundException(`Unknown sales order line: ${requested.salesOrderLineId}`);
      const remaining = Number(line.quantityOrdered) - Number(line.quantityInvoiced);
      if (requested.quantity > remaining) {
        throw new BadRequestException(
          `Cannot invoice ${requested.quantity} of "${line.description}": only ${remaining} remains un-invoiced on this line.`,
        );
      }
      return {
        productId: line.productId ?? undefined,
        description: line.description,
        quantity: requested.quantity,
        unitPrice: Number(line.unitPrice),
        discountPercent: line.discountPercent != null ? Number(line.discountPercent) : undefined,
        taxRateId: line.taxRateId ?? undefined,
        salesOrderLineId: line.id,
      };
    });

    // Left as a draft — finalization/encaissement stays on Invoicing's own
    // page, which remains the single place an invoice actually gets
    // finalized/paid (Ventes decision: Invoicing is not dissolved).
    return this.invoicing.createInvoice(orgId, {
      type: 'CUSTOMER',
      siteId: order.siteId,
      partnerId: order.customerId,
      salesOrderId: order.id,
      lines: invoiceLines,
    });
  }

  // ---------------- Negotiated customer pricing ----------------

  async listPartnerProductPrices(orgId: string, partnerId?: string) {
    const prices = await this.prisma.partnerProductPrice.findMany({
      where: { orgId, ...(partnerId ? { partnerId } : {}) },
      include: { product: { select: { sku: true, name: true } }, partner: { select: { name: true } } },
    });
    return prices.map((p) => ({
      ...p,
      unitPrice: p.unitPrice != null ? Number(p.unitPrice) : null,
      discountPercent: p.discountPercent != null ? Number(p.discountPercent) : null,
    }));
  }

  async upsertPartnerProductPrice(orgId: string, dto: UpsertPartnerProductPriceDto) {
    const partner = await this.prisma.partner.findFirst({ where: { id: dto.partnerId, orgId } });
    if (!partner) throw new NotFoundException(`Unknown partner: ${dto.partnerId}`);
    const product = await this.prisma.product.findFirst({ where: { id: dto.productId, orgId } });
    if (!product) throw new NotFoundException(`Unknown product: ${dto.productId}`);

    const saved = await this.prisma.partnerProductPrice.upsert({
      where: { orgId_partnerId_productId: { orgId, partnerId: dto.partnerId, productId: dto.productId } },
      update: { unitPrice: dto.unitPrice ?? null, discountPercent: dto.discountPercent ?? null },
      create: { orgId, partnerId: dto.partnerId, productId: dto.productId, unitPrice: dto.unitPrice ?? null, discountPercent: dto.discountPercent ?? null },
    });
    return { ...saved, unitPrice: saved.unitPrice != null ? Number(saved.unitPrice) : null, discountPercent: saved.discountPercent != null ? Number(saved.discountPercent) : null };
  }

  async deletePartnerProductPrice(orgId: string, id: string) {
    const existing = await this.prisma.partnerProductPrice.findFirst({ where: { id, orgId } });
    if (!existing) throw new NotFoundException(`Unknown price entry: ${id}`);
    await this.prisma.partnerProductPrice.delete({ where: { id } });
  }

  // ---------------- Dashboard ----------------

  async getDashboard(orgId: string) {
    const now = new Date();
    const openQuotes = await this.prisma.salesOrder.count({ where: { orgId, kind: 'quote', status: { in: ['draft', 'sent'] } } });
    const openOrders = await this.prisma.salesOrder.findMany({
      where: { orgId, kind: 'order', status: { in: ['confirmed', 'partially_invoiced'] } },
      include: { lines: true, customer: true },
    });

    const openOrdersValue = openOrders.reduce(
      (sum, o) => sum + o.lines.reduce((s, l) => s + Number(l.unitPrice) * (Number(l.quantityOrdered) - Number(l.quantityInvoiced)), 0),
      0,
    );
    const overdue = openOrders.filter((o) => o.expectedDate && o.expectedDate < now);

    return {
      openQuotesCount: openQuotes,
      openOrdersCount: openOrders.length,
      openOrdersValue: Math.round(openOrdersValue * 100) / 100,
      overdueCount: overdue.length,
      overdueOrders: overdue.map((o) => ({ id: o.id, number: o.number, customer: o.customer.name, expectedDate: o.expectedDate })),
    };
  }

  // ---------------- PDF (Milestone 10) ----------------

  private async loadOrderForPdf(orgId: string, id: string) {
    const order = await this.prisma.salesOrder.findFirst({
      where: { id, orgId },
      include: { organization: true, customer: true, site: true, lines: { include: { product: true } } },
    });
    if (!order) throw new NotFoundException(`Unknown sales order: ${id}`);
    return order;
  }

  private orgForPdf(order: { organization: { name: string; address: string | null; nif: string | null; nis: string | null; rc: string | null; taxArticle: string | null; phone: string | null; logo: string | null } }) {
    return {
      name: order.organization.name,
      address: order.organization.address,
      nif: order.organization.nif,
      nis: order.organization.nis,
      rc: order.organization.rc,
      taxArticle: order.organization.taxArticle,
      phone: order.organization.phone,
      logo: order.organization.logo,
    };
  }

  /** Devis or bon de commande — what this org hands the customer, depending on the order's own `kind`. */
  async generateOrderPdf(orgId: string, id: string): Promise<Buffer> {
    const order = await this.loadOrderForPdf(orgId, id);

    let total = 0;
    const lines = order.lines.map((l) => {
      const qty = Number(l.quantityOrdered);
      const unitPrice = Number(l.unitPrice);
      const discountPercent = l.discountPercent != null ? Number(l.discountPercent) : 0;
      const lineTotal = qty * unitPrice * (1 - discountPercent / 100);
      total += lineTotal;
      return {
        cells: {
          product: l.product ? `${l.product.sku} — ${l.product.name}` : l.description,
          qty: String(qty),
          unitPrice: formatMoney(unitPrice),
          discount: discountPercent ? `${discountPercent}%` : '—',
          total: formatMoney(lineTotal),
        },
      };
    });

    return this.pdf.generate({
      title: order.kind === 'quote' ? 'DEVIS' : 'BON DE COMMANDE',
      number: order.number ?? '(brouillon)',
      date: order.createdAt,
      statusLabel: ORDER_STATUS_LABEL_FR[order.status] ?? order.status,
      referenceLine: order.promotedFromQuoteNumber ? `Devis d'origine : ${order.promotedFromQuoteNumber}` : null,
      org: this.orgForPdf(order),
      counterpartyLabel: 'CLIENT',
      counterparty: { name: order.customer.name, nif: order.customer.nif },
      meta: [
        { label: 'Site', value: order.site.name },
        ...(order.expectedDate ? [{ label: 'Date prévue', value: order.expectedDate.toLocaleDateString('fr-FR') }] : []),
      ],
      columns: [
        { key: 'product', label: 'Désignation', width: 175 },
        { key: 'qty', label: 'Qté', width: 45, align: 'right' as const },
        { key: 'unitPrice', label: 'Prix unitaire', width: 95, align: 'right' as const },
        { key: 'discount', label: 'Remise', width: 65, align: 'right' as const },
        { key: 'total', label: 'Total', width: 115, align: 'right' as const },
      ],
      lines,
      totalLabel: 'TOTAL',
      totalValue: `${formatMoney(total)} DZD`,
      footerNote: 'Document généré par Stockily.',
    });
  }

  /**
   * Bon de livraison — Ventes has no dedicated delivery-note entity (an
   * explicit scope decision: a commande's own lines already carry
   * quantityOrdered/quantityInvoiced, and nothing here tracks a delivery as
   * a distinct event from invoicing). Printed straight from the commande
   * instead: what's ordered, what's already been invoiced/shipped, and
   * what's still outstanding — a real picking/delivery slip without a new
   * table to keep in sync.
   */
  async generateDeliveryNotePdf(orgId: string, id: string): Promise<Buffer> {
    const order = await this.loadOrderForPdf(orgId, id);
    if (order.kind !== 'order') throw new BadRequestException('A delivery note only applies to a confirmed order, not a devis.');

    const lines = order.lines.map((l) => {
      const ordered = Number(l.quantityOrdered);
      const invoiced = Number(l.quantityInvoiced);
      return {
        cells: {
          product: l.product ? `${l.product.sku} — ${l.product.name}` : l.description,
          ordered: String(ordered),
          delivered: String(invoiced),
          remaining: String(Math.max(0, ordered - invoiced)),
        },
      };
    });

    return this.pdf.generate({
      title: 'BON DE LIVRAISON',
      number: order.number ?? '(brouillon)',
      date: new Date(),
      referenceLine: `Commande : ${order.number ?? '(brouillon)'}`,
      org: this.orgForPdf(order),
      counterpartyLabel: 'CLIENT',
      counterparty: { name: order.customer.name, nif: order.customer.nif },
      meta: [{ label: 'Site', value: order.site.name }],
      columns: [
        { key: 'product', label: 'Désignation', width: 220 },
        { key: 'ordered', label: 'Commandé', width: 90, align: 'right' as const },
        { key: 'delivered', label: 'Livré', width: 90, align: 'right' as const },
        { key: 'remaining', label: 'Restant', width: 95, align: 'right' as const },
      ],
      lines,
      footerNote: 'Document généré par Stockily.',
    });
  }

  // ---------------- Helpers ----------------

  private async assignNumber(tx: import('@prisma/client').Prisma.TransactionClient, orgId: string, docType: 'quote' | 'order'): Promise<string> {
    // Same atomic counter mechanism as Invoice/PurchaseOrder numbering — a
    // single INSERT...ON CONFLICT DO UPDATE...RETURNING statement, safe
    // under concurrent creation via Postgres's own row-level locking.
    const prefix = docType === 'quote' ? 'DEV' : 'CMD';
    const year = new Date().getFullYear();
    const rows = await tx.$queryRaw<{ lastNumber: number }[]>`
      INSERT INTO "sales_order_counters" ("orgId", "year", "docType", "lastNumber")
      VALUES (${orgId}, ${year}, ${docType}, 1)
      ON CONFLICT ("orgId", "year", "docType")
      DO UPDATE SET "lastNumber" = "sales_order_counters"."lastNumber" + 1
      RETURNING "lastNumber"
    `;
    return `${prefix}-${year}-${String(rows[0].lastNumber).padStart(6, '0')}`;
  }

  /** Resolves each line's effective unitPrice — explicit override, else PartnerProductPrice (negotiated customer pricing), else Product.sellPrice — and validates the product-vs-description shape. */
  private async resolveLinePrices(orgId: string, customerId: string, lines: CreateSalesOrderLineDto[]) {
    return Promise.all(
      lines.map(async (l) => {
        if (!l.productId) {
          if (!l.description) throw new BadRequestException('A service line (no productId) requires a description.');
          if (l.unitPrice == null) throw new BadRequestException('A service line (no productId) requires an explicit unitPrice.');
          return { ...l, description: l.description, unitPrice: l.unitPrice };
        }

        const product = await this.prisma.product.findFirst({ where: { id: l.productId, orgId } });
        if (!product) throw new NotFoundException(`Unknown product: ${l.productId}`);
        const description = l.description ?? product.name;

        if (l.unitPrice != null) return { ...l, description, unitPrice: l.unitPrice };

        const negotiated = await this.prisma.partnerProductPrice.findUnique({
          where: { orgId_partnerId_productId: { orgId, partnerId: customerId, productId: l.productId } },
        });
        if (negotiated?.unitPrice != null) return { ...l, description, unitPrice: Number(negotiated.unitPrice) };
        if (negotiated?.discountPercent != null && product.sellPrice != null) {
          const discounted = Number(product.sellPrice) * (1 - Number(negotiated.discountPercent) / 100);
          return { ...l, description, unitPrice: Math.round(discounted * 100) / 100 };
        }
        return { ...l, description, unitPrice: product.sellPrice != null ? Number(product.sellPrice) : 0 };
      }),
    );
  }
}
