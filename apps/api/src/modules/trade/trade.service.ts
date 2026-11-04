import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { setTenantOnTransaction } from '@org/infra-db';
import { PrismaService } from '../../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { InvoicingService } from '../invoicing/invoicing.service';
import { LedgerService, LedgerSide } from '../invoicing/ledger.service';
import { nextDocumentNumber } from '../invoicing/document-numbering';
import { CreatePartnerPaymentDto, CreateTradeDocumentDto, TradeDocumentType } from './dto/trade.dto';

const PREFIX: Record<TradeDocumentType, string> = { delivery_note: 'BL', customer_return: 'RC', supplier_return: 'RF' };
const SIDE: Record<TradeDocumentType, LedgerSide> = { delivery_note: 'customer', customer_return: 'customer', supplier_return: 'supplier' };
/** Money that moves *with* each kind of bon: a client pays a BL, we refund a retour client, a fournisseur refunds a retour. */
const PAYMENT_DIRECTION: Record<TradeDocumentType, 'in' | 'out'> = { delivery_note: 'in', customer_return: 'out', supplier_return: 'in' };

const DOCUMENT_INCLUDE = {
  partner: { select: { id: true, name: true, code: true } },
  site: { select: { id: true, name: true } },
  salesOrder: { select: { id: true, number: true } },
  invoice: { select: { id: true, number: true, status: true } },
  lines: { include: { taxRate: true, product: { select: { sku: true, name: true, unitsPerCarton: true } } } },
} satisfies Prisma.TradeDocumentInclude;

type DocumentWithLines = Prisma.TradeDocumentGetPayload<{ include: typeof DOCUMENT_INCLUDE }>;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Bons de livraison, retours client and retours fournisseur — each moves
 * stock the moment it's validated and counts in the partner balance (see
 * LedgerService). A BL can come from a commande client (releasing what that
 * commande had reserved) and can later be invoiced, alone or grouped.
 */
@Injectable()
export class TradeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly invoicing: InvoicingService,
    private readonly ledger: LedgerService,
  ) {}

  // ───────────────────────── Documents ─────────────────────────

  async createDocument(orgId: string, performedBy: string, dto: CreateTradeDocumentDto) {
    const site = await this.prisma.site.findFirst({ where: { id: dto.siteId, orgId } });
    if (!site) throw new NotFoundException(`Dépôt inconnu : ${dto.siteId}`);

    let partnerId = dto.partnerId ?? null;
    let siteId = dto.siteId;
    let order: Prisma.SalesOrderGetPayload<{ include: { lines: true } }> | null = null;

    if (dto.salesOrderId) {
      if (dto.type !== 'delivery_note') throw new BadRequestException('Seul un bon de livraison peut être émis depuis une commande.');
      order = await this.prisma.salesOrder.findFirst({ where: { id: dto.salesOrderId, orgId, deletedAt: null }, include: { lines: { where: { deletedAt: null } } } });
      if (!order) throw new NotFoundException(`Commande inconnue : ${dto.salesOrderId}`);
      if (order.kind !== 'order') throw new BadRequestException('Transformez d’abord le devis en commande.');
      if (order.status === 'cancelled') throw new BadRequestException('Impossible de livrer une commande annulée.');
      partnerId = order.customerId;
      siteId = order.siteId;
    }

    let partner: { id: string; isCustomer: boolean; isSupplier: boolean; priceTier: number; name: string } | null = null;
    if (partnerId) {
      partner = await this.prisma.partner.findFirst({
        where: { id: partnerId, orgId, deletedAt: null },
        select: { id: true, isCustomer: true, isSupplier: true, priceTier: true, name: true },
      });
      if (!partner) throw new NotFoundException(`Partenaire inconnu : ${partnerId}`);
      if (dto.type === 'supplier_return' && !partner.isSupplier) throw new BadRequestException(`${partner.name} n’est pas un fournisseur.`);
      if (dto.type !== 'supplier_return' && !partner.isCustomer) throw new BadRequestException(`${partner.name} n’est pas un client.`);
    } else if (dto.type === 'supplier_return') {
      throw new BadRequestException('Choisissez le fournisseur du retour.');
    }
    if (dto.payment && !partner) {
      throw new BadRequestException('Un versement doit être rattaché à un client ou un fournisseur.');
    }

    // Resolve every line (description, price, order line) before the transaction.
    const resolved = await Promise.all(
      dto.lines.map(async (l) => {
        if (l.salesOrderLineId) {
          const soLine = order?.lines.find((x) => x.id === l.salesOrderLineId);
          if (!soLine) throw new BadRequestException('Ligne de commande inconnue pour cette commande.');
          const pendingDraft = await this.prisma.invoiceLine.aggregate({
            where: { salesOrderLineId: soLine.id, invoice: { status: 'draft', deletedAt: null } },
            _sum: { quantity: true },
          });
          const remaining =
            Number(soLine.quantityOrdered) - Number(soLine.quantityInvoiced) - Number(soLine.quantityDelivered) - Number(pendingDraft._sum.quantity ?? 0);
          if (l.quantity > remaining + 1e-9) {
            throw new BadRequestException(`« ${soLine.description} » : ${l.quantity} demandé(s), seulement ${Math.max(0, remaining)} reste(nt) à livrer.`);
          }
          return {
            productId: soLine.productId,
            description: soLine.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice ?? Number(soLine.unitPrice),
            discountPercent: l.discountPercent ?? (soLine.discountPercent != null ? Number(soLine.discountPercent) : null),
            taxRateId: l.taxRateId ?? soLine.taxRateId,
            salesOrderLineId: soLine.id,
          };
        }
        if (!l.productId) {
          if (!l.description) throw new BadRequestException('Une ligne sans produit doit avoir une désignation.');
          if (l.unitPrice == null) throw new BadRequestException('Une ligne sans produit doit avoir un prix.');
          return { productId: null, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, discountPercent: l.discountPercent ?? null, taxRateId: l.taxRateId ?? null, salesOrderLineId: null };
        }
        const product = await this.prisma.product.findFirst({ where: { id: l.productId, orgId, deletedAt: null } });
        if (!product) throw new NotFoundException(`Produit inconnu : ${l.productId}`);
        let unitPrice = l.unitPrice;
        if (unitPrice == null) {
          if (dto.type === 'supplier_return') unitPrice = Number(product.averageCost);
          else {
            const tierPrice = partner?.priceTier === 2 && product.sellPrice2 != null ? product.sellPrice2 : product.sellPrice;
            unitPrice = tierPrice != null ? Number(tierPrice) : 0;
          }
        }
        return {
          productId: product.id,
          description: l.description ?? product.name,
          quantity: l.quantity,
          unitPrice,
          discountPercent: l.discountPercent ?? null,
          taxRateId: l.taxRateId ?? null,
          salesOrderLineId: null,
        };
      }),
    );

    const collectedEvents: { kind: string }[] = [];
    const created = await this.prisma.$transaction(async (tx) => {
      await setTenantOnTransaction(tx, orgId);
      const number = await nextDocumentNumber(tx, orgId, dto.type, PREFIX[dto.type]);
      const doc = await tx.tradeDocument.create({
        data: {
          orgId,
          type: dto.type,
          number,
          siteId,
          partnerId,
          salesOrderId: order?.id ?? null,
          notes: dto.notes ?? null,
          createdBy: performedBy,
          lines: { create: resolved },
        },
        include: { lines: true },
      });

      for (const line of doc.lines) {
        if (!line.productId) continue;
        const product = await tx.product.findUniqueOrThrow({ where: { id: line.productId }, select: { averageCost: true } });
        const result = await this.moveStock(tx, orgId, performedBy, {
          productId: line.productId,
          siteId,
          // BL and retour fournisseur take stock out; a retour client brings it back in at the current average cost.
          type: dto.type === 'customer_return' ? 'IN' : 'OUT',
          quantity: Number(line.quantity),
          partnerId: partnerId ?? undefined,
          unitCost: dto.type === 'customer_return' ? Number(product.averageCost) : undefined,
          relatedEntityType: 'trade_document_line',
          relatedEntityId: line.id,
          description: line.description,
        });
        collectedEvents.push(...result.events);

        if (line.salesOrderLineId) {
          await this.stock.releaseInTransaction(tx, { orgId, productId: line.productId, siteId, quantity: Number(line.quantity), performedBy });
        }
      }
      for (const line of doc.lines) {
        if (line.salesOrderLineId) {
          await tx.salesOrderLine.update({ where: { id: line.salesOrderLineId }, data: { quantityDelivered: { increment: Number(line.quantity) } } });
        }
      }
      if (order) await this.recomputeOrderStatus(tx, order.id);

      if (dto.payment && partnerId) {
        await tx.partnerPayment.create({
          data: {
            orgId,
            partnerId,
            direction: PAYMENT_DIRECTION[dto.type],
            amount: dto.payment.amount,
            method: dto.payment.method ?? 'especes',
            documentType: dto.type,
            documentId: doc.id,
            createdBy: performedBy,
          },
        });
      }
      return doc;
    });

    this.stock.publishEvents(collectedEvents);
    return this.getDocument(orgId, created.id);
  }

  async listDocuments(orgId: string, filters: { type?: string; partnerId?: string; salesOrderId?: string }) {
    const docs = await this.prisma.tradeDocument.findMany({
      where: {
        orgId,
        ...(filters.type ? { type: filters.type } : {}),
        ...(filters.partnerId ? { partnerId: filters.partnerId } : {}),
        ...(filters.salesOrderId ? { salesOrderId: filters.salesOrderId } : {}),
      },
      include: DOCUMENT_INCLUDE,
      orderBy: { issuedAt: 'desc' },
    });
    const payments = await this.prisma.partnerPayment.findMany({
      where: { orgId, cancelledAt: null, documentId: { in: docs.map((d) => d.id) } },
      select: { documentId: true, amount: true },
    });
    const paidByDoc = new Map<string, number>();
    for (const p of payments) paidByDoc.set(p.documentId as string, (paidByDoc.get(p.documentId as string) ?? 0) + Number(p.amount));
    // Payments on the facture generated from a bon count as paid on the bon.
    const invoiced = docs.filter((d) => d.invoice && d.invoice.status !== 'void' && d.invoiceId);
    if (invoiced.length > 0) {
      const invPayments = await this.prisma.payment.findMany({
        where: { invoiceId: { in: invoiced.map((d) => d.invoiceId as string) } },
        select: { invoiceId: true, amount: true },
      });
      for (const d of invoiced) {
        const extra = invPayments.filter((p) => p.invoiceId === d.invoiceId).reduce((s, p) => s + Number(p.amount), 0);
        if (extra) paidByDoc.set(d.id, (paidByDoc.get(d.id) ?? 0) + extra);
      }
    }
    return docs.map((d) => this.serialize(d, paidByDoc.get(d.id) ?? 0));
  }

  async getDocument(orgId: string, id: string, types?: TradeDocumentType[]) {
    const doc = await this.prisma.tradeDocument.findFirst({ where: { id, orgId, ...(types ? { type: { in: types } } : {}) }, include: DOCUMENT_INCLUDE });
    if (!doc) throw new NotFoundException(`Document inconnu : ${id}`);
    const payments = await this.prisma.partnerPayment.findMany({ where: { orgId, documentId: id, cancelledAt: null }, orderBy: { paidAt: 'asc' } });
    // Payments recorded on the facture generated from this bon count too.
    const invoicePayments =
      doc.invoice && doc.invoice.status !== 'void' && doc.invoiceId
        ? await this.prisma.payment.findMany({ where: { invoiceId: doc.invoiceId }, orderBy: { paidAt: 'asc' } })
        : [];
    const paid = payments.reduce((s, p) => s + Number(p.amount), 0) + invoicePayments.reduce((s, p) => s + Number(p.amount), 0);
    const account =
      doc.partnerId && doc.status === 'validated'
        ? await this.ledger.balanceAroundDocument(orgId, doc.partnerId, doc.id, SIDE[doc.type as TradeDocumentType], doc.invoice?.status !== 'void' ? doc.invoiceId : null)
        : null;
    return {
      ...this.serialize(doc, paid),
      payments: payments.map((p) => ({ ...p, amount: Number(p.amount) })),
      invoicePayments: invoicePayments.map((p) => ({ id: p.id, amount: Number(p.amount), method: p.method, paidAt: p.paidAt })),
      account,
    };
  }

  async cancelDocument(orgId: string, performedBy: string, id: string, types: TradeDocumentType[]) {
    const doc = await this.prisma.tradeDocument.findFirst({ where: { id, orgId, type: { in: types } }, include: { lines: true } });
    if (!doc) throw new NotFoundException(`Document inconnu : ${id}`);
    if (doc.status === 'cancelled') throw new BadRequestException('Ce document est déjà annulé.');
    if (doc.invoiceId) {
      const inv = await this.prisma.invoice.findFirst({ where: { id: doc.invoiceId, deletedAt: null, status: { not: 'void' } } });
      if (inv) throw new BadRequestException(`Ce bon est facturé (${inv.number ?? 'facture brouillon'}) — supprimez ou annulez d’abord la facture.`);
    }

    const collectedEvents: { kind: string }[] = [];
    await this.prisma.$transaction(async (tx) => {
      await setTenantOnTransaction(tx, orgId);
      for (const line of doc.lines) {
        if (!line.productId) continue;
        // Exact reverse of the original movement.
        const result = await this.moveStock(tx, orgId, performedBy, {
          productId: line.productId,
          siteId: doc.siteId,
          type: doc.type === 'customer_return' ? 'OUT' : 'IN',
          quantity: Number(line.quantity),
          partnerId: doc.partnerId ?? undefined,
          relatedEntityType: 'trade_document_line_cancel',
          relatedEntityId: line.id,
          description: line.description,
        });
        collectedEvents.push(...result.events);
        if (line.salesOrderLineId) {
          await tx.salesOrderLine.update({ where: { id: line.salesOrderLineId }, data: { quantityDelivered: { decrement: Number(line.quantity) } } });
          // The commande holds this quantity reserved again.
          await this.stock.reserveInTransaction(tx, { orgId, productId: line.productId, siteId: doc.siteId, quantity: Number(line.quantity), allowBackorder: true, performedBy });
        }
      }
      if (doc.salesOrderId) await this.recomputeOrderStatus(tx, doc.salesOrderId);
      await tx.partnerPayment.updateMany({ where: { orgId, documentId: doc.id, cancelledAt: null }, data: { cancelledAt: new Date() } });
      await tx.tradeDocument.update({ where: { id }, data: { status: 'cancelled', cancelledAt: new Date(), invoiceId: null } });
    });
    this.stock.publishEvents(collectedEvents);
    return this.getDocument(orgId, id);
  }

  /**
   * One finalized facture for one or more bons de livraison of the same
   * client and dépôt — numbered right away, no separate "finaliser" step
   * (the bons are already validated). Versements made on the bons count as
   * already paid on the facture.
   */
  async invoiceDeliveryNotes(orgId: string, performedBy: string, documentIds: string[]) {
    const docs = await this.prisma.tradeDocument.findMany({
      where: { orgId, id: { in: documentIds } },
      include: { lines: true },
      orderBy: { issuedAt: 'asc' },
    });
    if (docs.length !== documentIds.length) throw new NotFoundException('Bon de livraison introuvable.');
    for (const d of docs) {
      if (d.type !== 'delivery_note') throw new BadRequestException(`${d.number} n’est pas un bon de livraison.`);
      if (d.status !== 'validated') throw new BadRequestException(`${d.number} est annulé.`);
      if (d.invoiceId) {
        const inv = await this.prisma.invoice.findFirst({ where: { id: d.invoiceId, deletedAt: null, status: { not: 'void' } } });
        if (inv) throw new BadRequestException(`${d.number} est déjà facturé.`);
      }
    }
    const partnerIds = new Set(docs.map((d) => d.partnerId ?? ''));
    const siteIds = new Set(docs.map((d) => d.siteId));
    if (partnerIds.size > 1) throw new BadRequestException('Les bons sélectionnés doivent être du même client.');
    if (siteIds.size > 1) throw new BadRequestException('Les bons sélectionnés doivent être du même dépôt.');

    const invoice = await this.invoicing.createInvoice(
      orgId,
      {
        type: 'CUSTOMER',
        siteId: docs[0].siteId,
        partnerId: docs[0].partnerId ?? undefined,
        lines: docs.flatMap((d) =>
          d.lines.map((l) => ({
            productId: l.productId ?? undefined,
            description: docs.length > 1 ? `${l.description} (${d.number})` : l.description,
            quantity: Number(l.quantity),
            unitPrice: Number(l.unitPrice),
            discountPercent: l.discountPercent != null ? Number(l.discountPercent) : undefined,
            taxRateId: l.taxRateId ?? undefined,
          })),
        ),
      },
      { fromDocuments: true },
    );
    await this.prisma.tradeDocument.updateMany({ where: { orgId, id: { in: documentIds } }, data: { invoiceId: invoice.id } });
    try {
      await this.invoicing.finalizeInvoice(orgId, invoice.id, performedBy);
    } catch (err) {
      // e.g. company legal details missing: don't leave a half-done draft behind.
      await this.invoicing.softDeleteInvoice(orgId, invoice.id);
      throw err;
    }
    await this.invoicing.syncDocumentInvoiceStatus(orgId, invoice.id);
    return this.invoicing.getInvoiceDetail(orgId, invoice.id);
  }

  // ───────────────────────── Versements ─────────────────────────

  async createPayment(orgId: string, performedBy: string, dto: CreatePartnerPaymentDto) {
    const partner = await this.prisma.partner.findFirst({ where: { id: dto.partnerId, orgId, deletedAt: null } });
    if (!partner) throw new NotFoundException(`Partenaire inconnu : ${dto.partnerId}`);
    if (dto.documentId) {
      const exists =
        dto.documentType === 'purchase_receipt'
          ? await this.prisma.purchaseReceipt.findFirst({ where: { id: dto.documentId, orgId, supplierId: partner.id, cancelledAt: null } })
          : await this.prisma.tradeDocument.findFirst({ where: { id: dto.documentId, orgId, partnerId: partner.id, status: 'validated' } });
      if (!exists) throw new BadRequestException('Bon introuvable pour ce partenaire.');
    }
    const payment = await this.prisma.partnerPayment.create({
      data: {
        orgId,
        partnerId: partner.id,
        direction: dto.direction,
        amount: dto.amount,
        method: dto.method ?? 'especes',
        notes: dto.notes ?? null,
        paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
        documentType: dto.documentId ? dto.documentType ?? null : null,
        documentId: dto.documentId ?? null,
        createdBy: performedBy,
      },
    });
    await this.syncInvoiceOfDocument(orgId, payment.documentId);
    return { ...payment, amount: Number(payment.amount) };
  }

  private async syncInvoiceOfDocument(orgId: string, documentId: string | null) {
    if (!documentId) return;
    const doc = await this.prisma.tradeDocument.findFirst({ where: { id: documentId, orgId }, select: { invoiceId: true } });
    if (doc?.invoiceId) await this.invoicing.syncDocumentInvoiceStatus(orgId, doc.invoiceId);
  }

  async cancelPayment(orgId: string, id: string) {
    const payment = await this.prisma.partnerPayment.findFirst({ where: { id, orgId, cancelledAt: null } });
    if (!payment) throw new NotFoundException(`Versement inconnu : ${id}`);
    await this.prisma.partnerPayment.update({ where: { id }, data: { cancelledAt: new Date() } });
    await this.syncInvoiceOfDocument(orgId, payment.documentId);
  }

  /** Relevé de compte: every entry with the running balance per side. */
  async statement(orgId: string, partnerId: string) {
    const partner = await this.prisma.partner.findFirst({ where: { id: partnerId, orgId } });
    if (!partner) throw new NotFoundException(`Partenaire inconnu : ${partnerId}`);
    const entries = await this.ledger.entries(orgId, partnerId);
    const running: Record<LedgerSide, number> = { customer: 0, supplier: 0 };
    const rows = entries.map((e) => {
      running[e.side] = round2(running[e.side] + e.amount);
      return { ...e, balanceAfter: running[e.side] };
    });
    const balances = (await this.ledger.balances(orgId)).get(partnerId);
    return { partner: { id: partner.id, name: partner.name, code: partner.code, isCustomer: partner.isCustomer, isSupplier: partner.isSupplier }, entries: rows, ...balances };
  }

  // ───────────────────────── helpers ─────────────────────────

  private async moveStock(
    tx: Prisma.TransactionClient,
    orgId: string,
    performedBy: string,
    input: { productId: string; siteId: string; type: 'IN' | 'OUT'; quantity: number; partnerId?: string; unitCost?: number; relatedEntityType: string; relatedEntityId: string; description: string },
  ) {
    const { description, ...movement } = input;
    try {
      return await this.stock.recordMovementInTransaction(tx, orgId, performedBy, movement);
    } catch (err) {
      if (err instanceof BadRequestException) {
        const body = err.getResponse();
        const parsed = typeof body === 'object' ? (body as Record<string, unknown>) : { message: body };
        if (parsed.error === 'negative_stock') {
          throw new BadRequestException({ ...parsed, message: `Stock insuffisant pour « ${description} » : ${parsed.requested} demandé(s), ${parsed.available} disponible(s).` });
        }
      }
      throw err;
    }
  }

  private async recomputeOrderStatus(tx: Prisma.TransactionClient, salesOrderId: string) {
    const lines = await tx.salesOrderLine.findMany({ where: { salesOrderId, deletedAt: null } });
    const fullyInvoiced = lines.every((l) => Number(l.quantityInvoiced) >= Number(l.quantityOrdered));
    const anyInvoiced = lines.some((l) => Number(l.quantityInvoiced) > 0);
    const fullyDone = lines.every((l) => Number(l.quantityInvoiced) + Number(l.quantityDelivered) >= Number(l.quantityOrdered));
    const anyDelivered = lines.some((l) => Number(l.quantityDelivered) > 0);
    const status = fullyInvoiced
      ? 'invoiced'
      : fullyDone && anyDelivered
        ? 'delivered'
        : anyDelivered
          ? 'partially_delivered'
          : anyInvoiced
            ? 'partially_invoiced'
            : 'confirmed';
    await tx.salesOrder.update({ where: { id: salesOrderId }, data: { status } });
  }

  private serialize(d: DocumentWithLines, paid: number) {
    const totals = LedgerService.documentTotal(d.lines);
    return {
      id: d.id,
      type: d.type,
      number: d.number,
      status: d.status,
      issuedAt: d.issuedAt,
      notes: d.notes,
      partner: d.partner,
      site: d.site,
      salesOrder: d.salesOrder,
      invoice: d.invoice && d.invoice.status !== 'void' ? d.invoice : null,
      lines: d.lines.map((l, i) => ({
        id: l.id,
        productId: l.productId,
        sku: l.product?.sku ?? null,
        unitsPerCarton: l.product?.unitsPerCarton ?? null,
        description: l.description,
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
        discountPercent: l.discountPercent != null ? Number(l.discountPercent) : null,
        taxRate: l.taxRate ? Number(l.taxRate.rate) : null,
        taxRateId: l.taxRateId,
        total: totals.lines[i].totalAmount,
      })),
      totals: { totalHt: totals.totalHt, totalTax: totals.totalTax, totalTtc: totals.totalTtc },
      paid: round2(paid),
    };
  }
}
