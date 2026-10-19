import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { setTenantOnTransaction } from '@org/infra-db';
import { PrismaService } from '../../prisma/prisma.service';
import { QualityService } from '../quality/quality.service';
import { StockService } from '../stock/stock.service';
import { InvoicingService } from '../invoicing/invoicing.service';
import { DocumentPdfService, formatMoney } from '../shared-pdf/document-pdf.service';
import { RecordQualityCheckDto } from '../quality/dto/record-quality-check.dto';
import { CreatePurchaseOrderDto, UpdatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { CreatePurchaseReceiptDto } from './dto/create-purchase-receipt.dto';
import { CreateRfqDto } from './dto/create-rfq.dto';
import { CreateSupplierInvoiceDto } from './dto/create-supplier-invoice.dto';
import { UpdateRfqPricesDto } from './dto/update-rfq-prices.dto';

// Thin NestJS orchestration layer, same shape as Stock/QualityService
// (docs/Action Plan.md §1/§5). Purchasing has no domain-* package of its
// own — unlike Stock/Quality/Invoicing, there's no framework-agnostic
// business rule here that isn't already owned by StockService (the ledger)
// or QualityService (batches/checks); this module's own job is genuinely
// just orchestration (create a PO, turn a receipt into the right sequence
// of existing calls) plus its own two tables' CRUD, which is why it talks
// to Prisma directly for those rather than adding a @org/domain-purchasing
// package with nothing but a pass-through in it.
// Prisma serializes `Decimal` fields (quantityOrdered/quantityReceived/
// unitCost) as strings over JSON, not numbers (Decimal.js's own toJSON,
// to avoid floating-point precision loss) — a real bug, not a hypothetical:
// found live in Chrome, `unitCost.toFixed is not a function` in the order
// detail modal, since PurchasingService returned raw Prisma results without
// converting them. StockService/InvoicingService already establish the
// fix-at-the-service-boundary convention (e.g.
// `quantityOnHand: Number(level.quantityOnHand)` in stock.service.ts) —
// applied here the same way, once, at every return point.
function serializeOrderLine<T extends { quantityOrdered: unknown; quantityReceived: unknown; unitCost: unknown }>(l: T) {
  return { ...l, quantityOrdered: Number(l.quantityOrdered), quantityReceived: Number(l.quantityReceived), unitCost: Number(l.unitCost) };
}
function serializeReceiptLine<T extends { quantityReceived: unknown; unitCost: unknown; landedCostShare?: unknown }>(l: T) {
  return {
    ...l,
    quantityReceived: Number(l.quantityReceived),
    unitCost: Number(l.unitCost),
    landedCostShare: l.landedCostShare != null ? Number(l.landedCostShare) : null,
  };
}
function serializeOrder<T extends { lines: unknown[] }>(o: T) {
  return { ...o, lines: (o.lines as Parameters<typeof serializeOrderLine>[0][]).map(serializeOrderLine) };
}
function serializeReceipt<T extends { lines: unknown[]; landedCostAmount?: unknown }>(r: T) {
  return {
    ...r,
    landedCostAmount: r.landedCostAmount != null ? Number(r.landedCostAmount) : null,
    lines: (r.lines as Parameters<typeof serializeReceiptLine>[0][]).map(serializeReceiptLine),
  };
}

const PO_STATUS_LABEL_FR: Record<string, string> = {
  draft: 'Brouillon',
  confirmed: 'Confirmé',
  partially_received: 'Partiellement reçu',
  received: 'Reçu',
  cancelled: 'Annulé',
  rfq: 'En comparaison (RFQ)',
  rfq_rejected: 'Rejeté (RFQ)',
};

@Injectable()
export class PurchasingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly quality: QualityService,
    private readonly invoicing: InvoicingService,
    private readonly pdf: DocumentPdfService,
  ) {}

  // ---------------- Purchase orders ----------------

  async createPurchaseOrder(orgId: string, performedBy: string, dto: CreatePurchaseOrderDto) {
    const supplier = await this.prisma.partner.findFirst({ where: { id: dto.supplierId, orgId, deletedAt: null } });
    if (!supplier) throw new NotFoundException(`Fournisseur inconnu : ${dto.supplierId}`);
    if (!supplier.isSupplier) {
      throw new BadRequestException(`Le partenaire ${supplier.name} n'est pas marqué comme fournisseur.`);
    }

    return this.prisma.$transaction(async (tx) => {
      // Milestone 8 (RLS) — required first statement, same reasoning as
      // every other interactive $transaction in this codebase (see
      // rls-extension.ts's doc): the extension never auto-wraps calls
      // already inside one.
      await setTenantOnTransaction(tx, orgId);
      // Same atomic counter mechanism as Invoice numbering
      // (InvoicingService.finalizeInvoice) — a single
      // INSERT ... ON CONFLICT DO UPDATE ... RETURNING statement, safe
      // under concurrent creation via Postgres's own row-level locking, not
      // a read-then-write from application code. No Décret 05-468-style
      // legal gapless requirement applies here — reused purely for
      // consistency with the one other numbered-document pattern in this
      // codebase, not because it's required.
      const year = new Date().getFullYear();
      const rows = await tx.$queryRaw<{ lastNumber: number }[]>`
        INSERT INTO "purchase_order_counters" ("orgId", "year", "lastNumber")
        VALUES (${orgId}, ${year}, 1)
        ON CONFLICT ("orgId", "year")
        DO UPDATE SET "lastNumber" = "purchase_order_counters"."lastNumber" + 1
        RETURNING "lastNumber"
      `;
      const number = `BC-${year}-${String(rows[0].lastNumber).padStart(6, '0')}`;

      const created = await tx.purchaseOrder.create({
        data: {
          orgId,
          siteId: dto.siteId,
          supplierId: dto.supplierId,
          number,
          // Created directly as "confirmed" — no separate draft/approval
          // step modeled in this scope (a PO a user creates here is already
          // meant to go to the supplier); "draft" stays a valid status
          // value in the schema for a future approval workflow, just never
          // assigned by this endpoint today.
          status: 'confirmed',
          expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : null,
          notes: dto.notes ?? null,
          createdBy: performedBy,
          lines: {
            create: dto.lines.map((l) => ({
              productId: l.productId,
              quantityOrdered: l.quantityOrdered,
              unitCost: l.unitCost,
            })),
          },
        },
        include: { lines: true, supplier: true, site: true },
      });
      return serializeOrder(created);
    });
  }

  async listPurchaseOrders(orgId: string, siteId?: string) {
    const orders = await this.prisma.purchaseOrder.findMany({
      where: { orgId, deletedAt: null, ...(siteId ? { siteId } : {}) },
      // `product: true` on lines here too — the frontend's order detail
      // modal is fed straight from this list's rows (no separate
      // getPurchaseOrder fetch on click), so it needs the same shape
      // getPurchaseOrder already returns. Found live: a real order's
      // product column rendered as a raw UUID instead of "SKU — Nom".
      // `receipts` (id + receivedAt only, not the full lines) added for
      // the same reason — the order detail modal lists past receipts with
      // a "bon de livraison" print link per one.
      include: { supplier: true, site: true, lines: { where: { deletedAt: null }, include: { product: true } }, receipts: { select: { id: true, receivedAt: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return orders.map(serializeOrder);
  }

  async getPurchaseOrder(orgId: string, id: string) {
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id, orgId, deletedAt: null },
      include: { supplier: true, site: true, lines: { where: { deletedAt: null }, include: { product: true } }, receipts: { include: { lines: true } } },
    });
    if (!order) throw new NotFoundException(`Bon de commande inconnu : ${id}`);
    return serializeOrder(order);
  }

  async updatePurchaseOrder(orgId: string, id: string, dto: UpdatePurchaseOrderDto) {
    const order = await this.prisma.purchaseOrder.findFirst({ where: { id, orgId, deletedAt: null }, include: { lines: true } });
    if (!order) throw new NotFoundException(`Bon de commande inconnu : ${id}`);
    if (order.lines.some((l) => Number(l.quantityReceived) > 0)) {
      throw new BadRequestException('Impossible d\'annuler un bon de commande qui a déjà une quantité reçue.');
    }
    if (order.status === 'received' || order.status === 'cancelled') {
      throw new BadRequestException(`Impossible d'annuler un bon de commande déjà « ${order.status} ».`);
    }

    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: dto.status, ...(dto.notes ? { notes: dto.notes } : {}) },
      include: { lines: true, supplier: true, site: true },
    });
    return serializeOrder(updated);
  }

  /**
   * Soft delete of a whole bon de commande (or one RFQ candidate) — never
   * physical, same convention as Product/Invoice. Blocked once anything has
   * been received against it: those receipts already moved stock and fed
   * the last-price history, and hiding their order would orphan them.
   */
  async deletePurchaseOrder(orgId: string, id: string) {
    const order = await this.prisma.purchaseOrder.findFirst({ where: { id, orgId, deletedAt: null }, include: { lines: true, receipts: { select: { id: true } } } });
    if (!order) throw new NotFoundException(`Bon de commande inconnu : ${id}`);
    if (order.receipts.length > 0 || order.lines.some((l) => Number(l.quantityReceived) > 0)) {
      throw new BadRequestException('Ce bon de commande a déjà été réceptionné, il ne peut plus être supprimé.');
    }
    await this.prisma.purchaseOrder.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  /**
   * Soft delete only — never physical, same convention as Product/Invoice
   * (see schema.prisma). Blocked once anything has actually been received
   * against the line (its receiptLines / quantityReceived would then point
   * at a line no longer shown on the order) or if it's the order's last
   * remaining line (an order with zero lines is meaningless).
   */
  async deleteOrderLine(orgId: string, orderId: string, lineId: string) {
    const order = await this.prisma.purchaseOrder.findFirst({ where: { id: orderId, orgId, deletedAt: null }, include: { lines: { where: { deletedAt: null } } } });
    if (!order) throw new NotFoundException(`Bon de commande inconnu : ${orderId}`);
    const line = order.lines.find((l) => l.id === lineId);
    if (!line) throw new NotFoundException(`Ligne inconnue : ${lineId}`);
    if (Number(line.quantityReceived) > 0) {
      throw new BadRequestException('Cette ligne a déjà été réceptionnée, elle ne peut plus être supprimée.');
    }
    if (order.lines.length <= 1) {
      throw new BadRequestException('Impossible de supprimer la dernière ligne d\'un bon de commande.');
    }
    await this.prisma.purchaseOrderLine.update({ where: { id: lineId }, data: { deletedAt: new Date() } });
    return this.getPurchaseOrder(orgId, orderId);
  }

  // ---------------- Receiving ----------------

  /**
   * Value-weighted pro-ration of a receipt's lump landedCostAmount
   * (transport/douane/assurance) across its lines, one line's share per
   * array index aligned with `lines`. The last line absorbs the rounding
   * remainder so the shares sum to exactly `landedCostAmount` — no penny
   * drift. Returns all-null when `landedCostAmount` is absent/zero,
   * meaning byte-identical behavior to before this milestone.
   */
  private allocateLandedCost(lines: CreatePurchaseReceiptDto['lines'], landedCostAmount?: number): (number | null)[] {
    if (!landedCostAmount) return lines.map(() => null);

    const rawValues = lines.map((l) => l.unitCost * l.quantity);
    const totalRawValue = rawValues.reduce((s, v) => s + v, 0);
    if (totalRawValue <= 0) {
      throw new BadRequestException(
        'Impossible de répartir le landedCostAmount sur des lignes dont la valeur totale est nulle — retirez-le ou donnez un unitCost positif à au moins une ligne.',
      );
    }

    const shares = rawValues.map((v) => Math.round((landedCostAmount * v) / totalRawValue * 100) / 100);
    const allocated = shares.reduce((s, v) => s + v, 0);
    const remainder = Math.round((landedCostAmount - allocated) * 100) / 100;
    shares[shares.length - 1] = Math.round((shares[shares.length - 1] + remainder) * 100) / 100;
    return shares;
  }

  async receiveGoods(orgId: string, performedBy: string, dto: CreatePurchaseReceiptDto) {
    let purchaseOrder = null;
    if (dto.purchaseOrderId) {
      purchaseOrder = await this.prisma.purchaseOrder.findFirst({ where: { id: dto.purchaseOrderId, orgId, deletedAt: null } });
      if (!purchaseOrder) throw new NotFoundException(`Bon de commande inconnu : ${dto.purchaseOrderId}`);
      if (purchaseOrder.status === 'cancelled') {
        throw new BadRequestException('Impossible de réceptionner un bon de commande annulé.');
      }
    }

    const landedCostShares = this.allocateLandedCost(dto.lines, dto.landedCostAmount);

    const receipt = await this.prisma.purchaseReceipt.create({
      data: {
        orgId,
        purchaseOrderId: dto.purchaseOrderId ?? null,
        siteId: dto.siteId,
        receivedBy: performedBy,
        notes: dto.notes ?? null,
        landedCostAmount: dto.landedCostAmount ?? null,
        landedCostNotes: dto.landedCostNotes ?? null,
      },
    });

    // Sequential, not one all-or-nothing DB transaction — deliberately the
    // same shape as Scan's existing new-lot Entrée flow (docs/MILESTONE_5.md:
    // "POST /quality/batches -> POST /quality/checks -> POST
    // /stock/movements", three separate calls). Stock movement posted
    // BEFORE the quality check on each line, not after — Milestone 7 Round 1
    // found that posting the check first made its quarantine calculation
    // read the ledger before the receipt's own units existed on it, so the
    // quarantine silently applied to nothing.
    for (const [index, line] of dto.lines.entries()) {
      let batchId: string | undefined = line.existingBatchId;
      if (line.newLot) {
        const batch = await this.quality.createBatch(orgId, {
          productId: line.productId,
          lotNumber: line.newLot.lotNumber,
          expiryDate: line.newLot.expiryDate,
          quantityReceived: line.quantity,
        });
        batchId = batch.id;
      }

      // landedCostShare is null unless dto.landedCostAmount was set — in
      // that case landedUnitCost is what actually feeds the WAC via
      // recordMovement below, while the line's own persisted `unitCost`
      // stays the raw supplier-negotiated figure (last-price-paid history).
      const landedCostShare = landedCostShares[index];
      const landedUnitCost = landedCostShare != null ? line.unitCost + landedCostShare / line.quantity : line.unitCost;

      await this.stock.recordMovement(orgId, performedBy, {
        productId: line.productId,
        siteId: dto.siteId,
        type: 'IN',
        quantity: line.quantity,
        batchId,
        partnerId: purchaseOrder?.supplierId,
        unitCost: landedUnitCost,
        relatedEntityType: 'purchase_receipt',
        relatedEntityId: receipt.id,
      });

      let qualityCheckId: string | undefined;
      if (line.qualityResult) {
        const checkDto: RecordQualityCheckDto = batchId
          ? { productId: line.productId, batchId, result: line.qualityResult, notes: line.qualityNotes }
          : { productId: line.productId, siteId: dto.siteId, quantity: line.quantity, result: line.qualityResult, notes: line.qualityNotes };
        const checkResult = await this.quality.recordQualityCheck(orgId, performedBy, checkDto);
        qualityCheckId = checkResult.check.id;
      }

      await this.prisma.purchaseReceiptLine.create({
        data: {
          receiptId: receipt.id,
          purchaseOrderLineId: line.purchaseOrderLineId ?? null,
          productId: line.productId,
          quantityReceived: line.quantity,
          unitCost: line.unitCost,
          landedCostShare: landedCostShare ?? null,
          batchId: batchId ?? null,
          qualityCheckId: qualityCheckId ?? null,
        },
      });

      if (line.purchaseOrderLineId) {
        await this.prisma.purchaseOrderLine.update({
          where: { id: line.purchaseOrderLineId },
          data: { quantityReceived: { increment: line.quantity } },
        });
      }
    }

    if (purchaseOrder) {
      await this.updatePurchaseOrderStatus(purchaseOrder.id);
    }

    return this.getReceipt(orgId, receipt.id);
  }

  async listReceipts(orgId: string, purchaseOrderId?: string) {
    const receipts = await this.prisma.purchaseReceipt.findMany({
      where: { orgId, ...(purchaseOrderId ? { purchaseOrderId } : {}) },
      include: { site: true, lines: { include: { product: true } } },
      orderBy: { receivedAt: 'desc' },
    });
    return receipts.map(serializeReceipt);
  }

  async getReceipt(orgId: string, id: string) {
    const receipt = await this.prisma.purchaseReceipt.findFirst({
      where: { id, orgId },
      include: { site: true, purchaseOrder: true, lines: { include: { product: true } } },
    });
    if (!receipt) throw new NotFoundException(`Réception inconnue : ${id}`);
    return serializeReceipt(receipt);
  }

  /** Derives a PO's status from its lines' cumulative quantityReceived — never set directly by a receiving call. */
  private async updatePurchaseOrderStatus(purchaseOrderId: string): Promise<void> {
    const lines = await this.prisma.purchaseOrderLine.findMany({ where: { purchaseOrderId } });
    const fullyReceived = lines.every((l) => Number(l.quantityReceived) >= Number(l.quantityOrdered));
    const anyReceived = lines.some((l) => Number(l.quantityReceived) > 0);
    const status = fullyReceived ? 'received' : anyReceived ? 'partially_received' : 'confirmed';
    await this.prisma.purchaseOrder.update({ where: { id: purchaseOrderId }, data: { status } });
  }

  // ---------------- Facture fournisseur (Milestone 10) ----------------

  /** Achats' own convenience wrapper around Invoicing's createInvoice — see the DTO's own doc for why this exists at all instead of just calling POST /invoicing/invoices directly. */
  async createSupplierInvoice(orgId: string, purchaseOrderId: string, dto: CreateSupplierInvoiceDto) {
    const po = await this.prisma.purchaseOrder.findFirst({ where: { id: purchaseOrderId, orgId, deletedAt: null } });
    if (!po) throw new NotFoundException(`Bon de commande inconnu : ${purchaseOrderId}`);

    return this.invoicing.createInvoice(orgId, {
      type: 'SUPPLIER',
      siteId: po.siteId,
      partnerId: po.supplierId,
      purchaseOrderId,
      number: dto.number,
      lines: dto.lines,
    });
  }

  // ---------------- RFQ / comparaison de prix (Milestone 10) ----------------

  /**
   * Creates N candidate PurchaseOrder rows (one per invited supplier,
   * status "rfq", number left null), all sharing one comparisonGroupId —
   * reuses PurchaseOrder rather than a dedicated RFQ entity (see
   * PLAN.md §4 for the reasoning: 100% of existing list/RLS/serialize code
   * applies unchanged). unitCost on each candidate's lines starts at 0 —
   * the point of an RFQ is for each supplier to come back with their own
   * quoted price, entered afterwards via updateRfqLinePrices below.
   */
  async createRfq(orgId: string, performedBy: string, dto: CreateRfqDto) {
    const site = await this.prisma.site.findFirst({ where: { id: dto.siteId, orgId } });
    if (!site) throw new NotFoundException(`Site inconnu : ${dto.siteId}`);
    const suppliers = await this.prisma.partner.findMany({ where: { id: { in: dto.supplierIds }, orgId, deletedAt: null, isSupplier: true } });
    if (suppliers.length !== dto.supplierIds.length) {
      throw new BadRequestException('Un ou plusieurs supplierIds sont inconnus ou non marqués comme fournisseur.');
    }

    const comparisonGroupId = crypto.randomUUID();
    const candidates = await Promise.all(
      suppliers.map((supplier) =>
        this.prisma.purchaseOrder.create({
          data: {
            orgId,
            siteId: dto.siteId,
            supplierId: supplier.id,
            status: 'rfq',
            comparisonGroupId,
            createdBy: performedBy,
            lines: {
              create: dto.productLines.map((l) => ({ productId: l.productId, quantityOrdered: l.quantity, unitCost: 0 })),
            },
          },
          include: { lines: { include: { product: true } }, supplier: true, site: true },
        }),
      ),
    );
    return { comparisonGroupId, candidates: candidates.map(serializeOrder) };
  }

  async getRfqGroup(orgId: string, comparisonGroupId: string) {
    const candidates = await this.prisma.purchaseOrder.findMany({
      where: { orgId, comparisonGroupId, deletedAt: null },
      include: { lines: { where: { deletedAt: null }, include: { product: true } }, supplier: true, site: true },
      orderBy: { createdAt: 'asc' },
    });
    if (candidates.length === 0) throw new NotFoundException(`Groupe de comparaison RFQ inconnu : ${comparisonGroupId}`);
    return candidates.map(serializeOrder);
  }

  /** Fills in the price a supplier actually quoted for one RFQ candidate — every candidate line starts at unitCost 0 (see createRfq); the buyer records the real quote here before comparing/awarding. Only touches lines still on an "rfq" order — once awarded/rejected, prices are frozen. */
  async updateRfqLinePrices(orgId: string, purchaseOrderId: string, dto: UpdateRfqPricesDto) {
    const order = await this.prisma.purchaseOrder.findFirst({ where: { id: purchaseOrderId, orgId, deletedAt: null }, include: { lines: true } });
    if (!order) throw new NotFoundException(`Bon de commande inconnu : ${purchaseOrderId}`);
    if (order.status !== 'rfq') throw new BadRequestException('Les prix ne peuvent être modifiés que tant que ce candidat est encore en comparaison (statut rfq).');

    const lineIds = new Set(order.lines.map((l) => l.id));
    for (const l of dto.lines) {
      if (!lineIds.has(l.lineId)) throw new BadRequestException(`La ligne ${l.lineId} n'appartient pas au bon de commande ${purchaseOrderId}.`);
    }

    return this.prisma.$transaction(async (tx) => {
      await setTenantOnTransaction(tx, orgId);
      for (const l of dto.lines) {
        await tx.purchaseOrderLine.update({ where: { id: l.lineId }, data: { unitCost: l.unitCost } });
      }
      const updated = await tx.purchaseOrder.findFirstOrThrow({
        where: { id: purchaseOrderId },
        include: { lines: { include: { product: true } }, supplier: true, site: true },
      });
      return serializeOrder(updated);
    });
  }

  /** Awards one candidate — assigns it a real number and confirms it; every sibling in the group flips to rfq_rejected, kept for audit history. */
  async awardRfq(orgId: string, comparisonGroupId: string, winningPurchaseOrderId: string) {
    const candidates = await this.prisma.purchaseOrder.findMany({ where: { orgId, comparisonGroupId, deletedAt: null } });
    if (candidates.length === 0) throw new NotFoundException(`Groupe de comparaison RFQ inconnu : ${comparisonGroupId}`);
    const winner = candidates.find((c) => c.id === winningPurchaseOrderId);
    if (!winner) throw new NotFoundException(`Le bon de commande ${winningPurchaseOrderId} ne fait pas partie du groupe de comparaison ${comparisonGroupId}`);
    if (winner.status !== 'rfq') throw new BadRequestException(`Ce candidat est déjà « ${winner.status} ».`);

    return this.prisma.$transaction(async (tx) => {
      await setTenantOnTransaction(tx, orgId);
      const year = new Date().getFullYear();
      const rows = await tx.$queryRaw<{ lastNumber: number }[]>`
        INSERT INTO "purchase_order_counters" ("orgId", "year", "lastNumber")
        VALUES (${orgId}, ${year}, 1)
        ON CONFLICT ("orgId", "year")
        DO UPDATE SET "lastNumber" = "purchase_order_counters"."lastNumber" + 1
        RETURNING "lastNumber"
      `;
      const number = `BC-${year}-${String(rows[0].lastNumber).padStart(6, '0')}`;

      const awarded = await tx.purchaseOrder.update({
        where: { id: winningPurchaseOrderId },
        data: { status: 'confirmed', number },
        include: { lines: true, supplier: true, site: true },
      });

      await tx.purchaseOrder.updateMany({
        where: { orgId, comparisonGroupId, deletedAt: null, id: { not: winningPurchaseOrderId }, status: 'rfq' },
        data: { status: 'rfq_rejected' },
      });

      return serializeOrder(awarded);
    });
  }

  // ---------------- Historique de prix (Milestone 10) ----------------

  /** Last price actually paid for a product — across every supplier, or scoped to one — read from PurchaseReceiptLine (the real, receipt-confirmed cost), not PurchaseOrderLine's own planning figure. */
  async getLastPricePaid(orgId: string, productId: string, supplierId?: string) {
    const line = await this.prisma.purchaseReceiptLine.findFirst({
      where: {
        productId,
        receipt: { orgId, ...(supplierId ? { purchaseOrder: { supplierId } } : {}) },
      },
      orderBy: { receipt: { receivedAt: 'desc' } },
      include: { receipt: { include: { purchaseOrder: { include: { supplier: true } } } } },
    });
    if (!line) return null;
    return {
      unitCost: Number(line.unitCost),
      receivedAt: line.receipt.receivedAt,
      supplier: line.receipt.purchaseOrder?.supplier ? { id: line.receipt.purchaseOrder.supplier.id, name: line.receipt.purchaseOrder.supplier.name } : null,
    };
  }

  // ---------------- Dashboard (Milestone 10) ----------------

  async getDashboard(orgId: string) {
    const now = new Date();
    const openOrders = await this.prisma.purchaseOrder.findMany({
      where: { orgId, deletedAt: null, status: { in: ['confirmed', 'partially_received'] } },
      include: { lines: { where: { deletedAt: null } }, supplier: true },
    });

    const openOrdersValue = openOrders.reduce(
      (sum, o) => sum + o.lines.reduce((s, l) => s + Number(l.unitCost) * (Number(l.quantityOrdered) - Number(l.quantityReceived)), 0),
      0,
    );
    const overdue = openOrders.filter((o) => o.expectedDate && o.expectedDate < now);
    const expectedSoon = openOrders.filter((o) => o.expectedDate && o.expectedDate >= now);

    return {
      openOrdersCount: openOrders.length,
      openOrdersValue: Math.round(openOrdersValue * 100) / 100,
      overdueCount: overdue.length,
      overdueOrders: overdue.map((o) => ({ id: o.id, number: o.number, supplier: o.supplier.name, expectedDate: o.expectedDate })),
      expectedSoonCount: expectedSoon.length,
    };
  }

  // ---------------- PDF ----------------

  /** Bon de commande — what this org sends to the supplier requesting the goods. */
  async generatePurchaseOrderPdf(orgId: string, id: string): Promise<Buffer> {
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id, orgId },
      include: { organization: true, supplier: true, site: true, lines: { where: { deletedAt: null }, include: { product: true } } },
    });
    if (!order) throw new NotFoundException(`Bon de commande inconnu : ${id}`);

    let total = 0;
    const lines = order.lines.map((l) => {
      const qty = Number(l.quantityOrdered);
      const unitCost = Number(l.unitCost);
      const lineTotal = qty * unitCost;
      total += lineTotal;
      return {
        cells: {
          product: l.product ? `${l.product.sku} — ${l.product.name}` : l.productId,
          qty: String(qty),
          unitCost: formatMoney(unitCost),
          total: formatMoney(lineTotal),
        },
      };
    });

    return this.pdf.generate({
      title: 'BON DE COMMANDE',
      number: order.number ?? '(brouillon)',
      date: order.createdAt,
      statusLabel: PO_STATUS_LABEL_FR[order.status] ?? order.status,
      org: {
        name: order.organization.name,
        address: order.organization.address,
        nif: order.organization.nif,
        nis: order.organization.nis,
        rc: order.organization.rc,
        taxArticle: order.organization.taxArticle,
        phone: order.organization.phone,
        logo: order.organization.logo,
      },
      counterpartyLabel: 'FOURNISSEUR',
      counterparty: { name: order.supplier.name, nif: order.supplier.nif },
      meta: [
        { label: 'Site de livraison', value: order.site.name },
        ...(order.expectedDate ? [{ label: 'Livraison prévue', value: order.expectedDate.toLocaleDateString('fr-FR') }] : []),
      ],
      columns: [
        { key: 'product', label: 'Désignation', width: 220 },
        { key: 'qty', label: 'Qté', width: 70, align: 'right' as const },
        { key: 'unitCost', label: 'Coût unitaire', width: 100, align: 'right' as const },
        { key: 'total', label: 'Total', width: 105, align: 'right' as const },
      ],
      lines,
      totalLabel: 'TOTAL',
      totalValue: `${formatMoney(total)} DZD`,
      footerNote: 'Document généré par Stockily.',
    });
  }

  /** Bon de livraison / réception — proof of what a supplier actually delivered against a receipt. */
  async generateReceiptPdf(orgId: string, id: string): Promise<Buffer> {
    const receipt = await this.prisma.purchaseReceipt.findFirst({
      where: { id, orgId },
      include: {
        organization: true,
        site: true,
        purchaseOrder: { include: { supplier: true } },
        lines: { include: { product: true, batch: true, qualityCheck: true } },
      },
    });
    if (!receipt) throw new NotFoundException(`Réception inconnue : ${id}`);

    const QUALITY_LABEL_FR: Record<string, string> = { conforme: 'Conforme', non_conforme: 'Non conforme' };
    const lines = receipt.lines.map((l) => {
      const extraParts: string[] = [];
      if (l.batch) extraParts.push(`Lot ${l.batch.lotNumber}`);
      if (l.qualityCheck) extraParts.push(QUALITY_LABEL_FR[l.qualityCheck.result] ?? l.qualityCheck.result);
      return {
        cells: {
          product: l.product ? `${l.product.sku} — ${l.product.name}` : l.productId,
          qty: String(Number(l.quantityReceived)),
          unitCost: formatMoney(Number(l.unitCost)),
          extra: extraParts.join(' · ') || '—',
        },
      };
    });

    return this.pdf.generate({
      title: 'BON DE LIVRAISON',
      number: receipt.purchaseOrder?.number ?? `RÉC-${receipt.id.slice(0, 8).toUpperCase()}`,
      date: receipt.receivedAt,
      referenceLine: receipt.purchaseOrder?.number ? `Bon de commande : ${receipt.purchaseOrder.number}` : 'Réception libre (sans bon de commande)',
      org: {
        name: receipt.organization.name,
        address: receipt.organization.address,
        nif: receipt.organization.nif,
        nis: receipt.organization.nis,
        rc: receipt.organization.rc,
        taxArticle: receipt.organization.taxArticle,
        phone: receipt.organization.phone,
        logo: receipt.organization.logo,
      },
      counterpartyLabel: 'FOURNISSEUR',
      counterparty: receipt.purchaseOrder?.supplier ? { name: receipt.purchaseOrder.supplier.name, nif: receipt.purchaseOrder.supplier.nif } : null,
      meta: [{ label: 'Site de réception', value: receipt.site.name }],
      columns: [
        { key: 'product', label: 'Désignation', width: 195 },
        { key: 'qty', label: 'Qté reçue', width: 70, align: 'right' as const },
        { key: 'unitCost', label: 'Coût unitaire', width: 95, align: 'right' as const },
        { key: 'extra', label: 'Lot / Contrôle', width: 135 },
      ],
      lines,
      footerNote: 'Document généré par Stockily.',
    });
  }
}
