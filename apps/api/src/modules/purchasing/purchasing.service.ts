import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { setTenantOnTransaction } from '@org/infra-db';
import { PrismaService } from '../../prisma/prisma.service';
import { QualityService } from '../quality/quality.service';
import { StockService } from '../stock/stock.service';
import { RecordQualityCheckDto } from '../quality/dto/record-quality-check.dto';
import { CreatePurchaseOrderDto, UpdatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { CreatePurchaseReceiptDto } from './dto/create-purchase-receipt.dto';

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
function serializeReceiptLine<T extends { quantityReceived: unknown; unitCost: unknown }>(l: T) {
  return { ...l, quantityReceived: Number(l.quantityReceived), unitCost: Number(l.unitCost) };
}
function serializeOrder<T extends { lines: unknown[] }>(o: T) {
  return { ...o, lines: (o.lines as Parameters<typeof serializeOrderLine>[0][]).map(serializeOrderLine) };
}
function serializeReceipt<T extends { lines: unknown[] }>(r: T) {
  return { ...r, lines: (r.lines as Parameters<typeof serializeReceiptLine>[0][]).map(serializeReceiptLine) };
}

@Injectable()
export class PurchasingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly quality: QualityService,
  ) {}

  // ---------------- Purchase orders ----------------

  async createPurchaseOrder(orgId: string, performedBy: string, dto: CreatePurchaseOrderDto) {
    const supplier = await this.prisma.partner.findFirst({ where: { id: dto.supplierId, orgId } });
    if (!supplier) throw new NotFoundException(`Unknown supplier: ${dto.supplierId}`);
    if (!supplier.isSupplier) {
      throw new BadRequestException(`Partner ${supplier.name} is not flagged as a supplier.`);
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
      where: { orgId, ...(siteId ? { siteId } : {}) },
      // `product: true` on lines here too — the frontend's order detail
      // modal is fed straight from this list's rows (no separate
      // getPurchaseOrder fetch on click), so it needs the same shape
      // getPurchaseOrder already returns. Found live: a real order's
      // product column rendered as a raw UUID instead of "SKU — Nom".
      include: { supplier: true, site: true, lines: { include: { product: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return orders.map(serializeOrder);
  }

  async getPurchaseOrder(orgId: string, id: string) {
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id, orgId },
      include: { supplier: true, site: true, lines: { include: { product: true } }, receipts: { include: { lines: true } } },
    });
    if (!order) throw new NotFoundException(`Unknown purchase order: ${id}`);
    return serializeOrder(order);
  }

  async updatePurchaseOrder(orgId: string, id: string, dto: UpdatePurchaseOrderDto) {
    const order = await this.prisma.purchaseOrder.findFirst({ where: { id, orgId }, include: { lines: true } });
    if (!order) throw new NotFoundException(`Unknown purchase order: ${id}`);
    if (order.lines.some((l) => Number(l.quantityReceived) > 0)) {
      throw new BadRequestException('Cannot cancel a purchase order that already has received quantity on it.');
    }
    if (order.status === 'received' || order.status === 'cancelled') {
      throw new BadRequestException(`Cannot cancel a purchase order already ${order.status}.`);
    }

    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: dto.status, ...(dto.notes ? { notes: dto.notes } : {}) },
      include: { lines: true, supplier: true, site: true },
    });
    return serializeOrder(updated);
  }

  // ---------------- Receiving ----------------

  async receiveGoods(orgId: string, performedBy: string, dto: CreatePurchaseReceiptDto) {
    let purchaseOrder = null;
    if (dto.purchaseOrderId) {
      purchaseOrder = await this.prisma.purchaseOrder.findFirst({ where: { id: dto.purchaseOrderId, orgId } });
      if (!purchaseOrder) throw new NotFoundException(`Unknown purchase order: ${dto.purchaseOrderId}`);
      if (purchaseOrder.status === 'cancelled') {
        throw new BadRequestException('Cannot receive against a cancelled purchase order.');
      }
    }

    const receipt = await this.prisma.purchaseReceipt.create({
      data: {
        orgId,
        purchaseOrderId: dto.purchaseOrderId ?? null,
        siteId: dto.siteId,
        receivedBy: performedBy,
        notes: dto.notes ?? null,
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
    for (const line of dto.lines) {
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

      await this.stock.recordMovement(orgId, performedBy, {
        productId: line.productId,
        siteId: dto.siteId,
        type: 'IN',
        quantity: line.quantity,
        batchId,
        partnerId: purchaseOrder?.supplierId,
        unitCost: line.unitCost,
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
    if (!receipt) throw new NotFoundException(`Unknown purchase receipt: ${id}`);
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
}
