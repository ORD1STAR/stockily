import { PrismaClient, Prisma } from '@prisma/client';
import type {
  BatchRecord,
  CreateBatchInput,
  InsertNonConformityInput,
  InsertQualityCheckInput,
  NonConformityRecord,
  ProductRecord,
  QualityCheckRecord,
  QualityDataPort,
} from '@org/domain-quality';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

function toBatchRecord(b: {
  id: string;
  orgId: string;
  productId: string;
  lotNumber: string;
  expiryDate: Date | null;
  quantityReceived: Prisma.Decimal;
  receivedAt: Date;
  status: string;
}): BatchRecord {
  return {
    id: b.id,
    orgId: b.orgId,
    productId: b.productId,
    lotNumber: b.lotNumber,
    expiryDate: b.expiryDate ? b.expiryDate.toISOString() : null,
    quantityReceived: Number(b.quantityReceived),
    receivedAt: b.receivedAt.toISOString(),
    status: b.status as BatchRecord['status'],
  };
}

function toCheckRecord(c: {
  id: string;
  orgId: string;
  productId: string;
  batchId: string | null;
  checkedBy: string | null;
  result: string;
  notes: string | null;
  checkedAt: Date;
}): QualityCheckRecord {
  return { ...c, result: c.result as QualityCheckRecord['result'], checkedAt: c.checkedAt.toISOString() };
}

function toNonConformityRecord(n: {
  id: string;
  orgId: string;
  productId: string;
  batchId: string | null;
  severity: string;
  status: string;
  resolutionNotes: string | null;
  createdAt: Date;
}): NonConformityRecord {
  return { ...n, status: n.status as NonConformityRecord['status'], createdAt: n.createdAt.toISOString() };
}

/**
 * Concrete Prisma implementation of `@org/domain-quality`'s `QualityDataPort`
 * — mirrors `PrismaStockDataPort`'s shape/transaction-handling exactly.
 *
 * `getBatchQuantityBySite` is the one genuinely nontrivial method: `StockLevel`
 * only aggregates per product+site, not per batch, so "how much of batch B is
 * on hand at site S" has to be reconstructed from the `stock_movements`
 * ledger itself. Approach and limitations:
 *  - IN adds, OUT subtracts — unambiguous.
 *  - TRANSFER: both legs of a transfer are stored as separate rows with
 *    `type: 'TRANSFER'`, one at the source site and one at the destination,
 *    with NO field on the row itself saying which is which. But
 *    apps/api/src/modules/sites/sites.service.ts's `createTransfer` (the
 *    only code path that creates TRANSFER movements today) always tags BOTH
 *    legs with `relatedEntityType: 'stock_transfer'` and
 *    `relatedEntityId: <the StockTransfer's own id>` — so direction is
 *    recovered exactly by looking up that StockTransfer row and comparing
 *    the movement's `siteId` to its `fromSiteId`/`toSiteId`. A TRANSFER
 *    movement that ISN'T linked to a resolvable StockTransfer (no current
 *    code path produces one) falls back to treating it as an outflow at its
 *    own site — a conservative (undercounting, never over-quarantines)
 *    approximation, not a silent guess.
 *  - ADJUSTMENT: `stock.service.ts`'s `createInventoryAdjustment` never
 *    passes a `batchId` through to the movement it records (confirmed by
 *    reading that file), so in the current codebase an ADJUSTMENT row never
 *    matches `WHERE batchId = X` and this method never has to reconstruct
 *    its direction. If a future change lets an adjustment target a specific
 *    batch, note that `StockMovement` stores only a positive `quantity` with
 *    no signed delta or direction column — this derivation (and arguably
 *    the schema) would need revisiting at that point, not before.
 */
export class PrismaQualityDataPort implements QualityDataPort {
  constructor(private readonly prisma: PrismaLike) {}

  async getProduct(orgId: string, productId: string): Promise<ProductRecord | null> {
    const p = await this.prisma.product.findFirst({ where: { id: productId, orgId }, select: { id: true, isLotTracked: true } });
    return p;
  }

  async createBatch(input: CreateBatchInput): Promise<BatchRecord> {
    const b = await this.prisma.batch.create({
      data: {
        orgId: input.orgId,
        productId: input.productId,
        lotNumber: input.lotNumber,
        expiryDate: input.expiryDate ? new Date(input.expiryDate) : null,
        quantityReceived: input.quantityReceived,
      },
    });
    return toBatchRecord(b);
  }

  async getBatch(orgId: string, batchId: string): Promise<BatchRecord | null> {
    const b = await this.prisma.batch.findFirst({ where: { id: batchId, orgId } });
    return b ? toBatchRecord(b) : null;
  }

  async listBatches(orgId: string, filters?: { productId?: string }): Promise<BatchRecord[]> {
    const rows = await this.prisma.batch.findMany({
      where: { orgId, ...(filters?.productId ? { productId: filters.productId } : {}) },
      orderBy: { receivedAt: 'desc' },
    });
    return rows.map(toBatchRecord);
  }

  async updateBatchStatus(batchId: string, status: 'active' | 'quarantined' | 'depleted'): Promise<void> {
    await this.prisma.batch.update({ where: { id: batchId }, data: { status } });
  }

  async getBatchQuantityBySite(orgId: string, batchId: string): Promise<Map<string, number>> {
    const movements = await this.prisma.stockMovement.findMany({
      where: { orgId, batchId },
      select: { siteId: true, type: true, quantity: true, relatedEntityType: true, relatedEntityId: true },
    });

    const totals = new Map<string, number>();
    const add = (siteId: string, delta: number) => totals.set(siteId, (totals.get(siteId) ?? 0) + delta);

    const transferIds = [
      ...new Set(
        movements
          .filter((m) => m.type === 'TRANSFER' && m.relatedEntityType === 'stock_transfer' && m.relatedEntityId)
          .map((m) => m.relatedEntityId as string),
      ),
    ];
    const transfers = transferIds.length
      ? await this.prisma.stockTransfer.findMany({ where: { id: { in: transferIds } }, select: { id: true, fromSiteId: true, toSiteId: true } })
      : [];
    const transferById = new Map(transfers.map((t) => [t.id, t]));

    for (const m of movements) {
      const qty = Number(m.quantity);
      if (m.type === 'IN') {
        add(m.siteId, qty);
      } else if (m.type === 'OUT') {
        add(m.siteId, -qty);
      } else if (m.type === 'TRANSFER') {
        const linked = m.relatedEntityId ? transferById.get(m.relatedEntityId) : undefined;
        if (linked && m.siteId === linked.fromSiteId) add(m.siteId, -qty);
        else if (linked && m.siteId === linked.toSiteId) add(m.siteId, qty);
        else add(m.siteId, -qty); // unlinked fallback — see class doc comment
      }
      // ADJUSTMENT: intentionally ignored here — see class doc comment.
    }

    const result = new Map<string, number>();
    for (const [siteId, qty] of totals) if (qty > 0) result.set(siteId, qty);
    return result;
  }

  async insertQualityCheck(input: InsertQualityCheckInput): Promise<QualityCheckRecord> {
    const c = await this.prisma.qualityCheck.create({
      data: {
        orgId: input.orgId,
        productId: input.productId,
        batchId: input.batchId,
        result: input.result,
        notes: input.notes,
        checkedBy: input.checkedBy,
      },
    });
    return toCheckRecord(c);
  }

  async listQualityChecks(orgId: string, filters: { batchId?: string; productId?: string }): Promise<QualityCheckRecord[]> {
    const rows = await this.prisma.qualityCheck.findMany({
      where: { orgId, ...(filters.batchId ? { batchId: filters.batchId } : {}), ...(filters.productId ? { productId: filters.productId } : {}) },
      orderBy: { checkedAt: 'desc' },
    });
    return rows.map(toCheckRecord);
  }

  async insertNonConformity(input: InsertNonConformityInput): Promise<NonConformityRecord> {
    const n = await this.prisma.nonConformity.create({
      data: { orgId: input.orgId, productId: input.productId, batchId: input.batchId, severity: input.severity },
    });
    return toNonConformityRecord(n);
  }

  async listNonConformities(orgId: string, status?: 'open' | 'resolved'): Promise<NonConformityRecord[]> {
    const rows = await this.prisma.nonConformity.findMany({
      where: { orgId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toNonConformityRecord);
  }

  async getNonConformity(orgId: string, id: string): Promise<NonConformityRecord | null> {
    const n = await this.prisma.nonConformity.findFirst({ where: { id, orgId } });
    return n ? toNonConformityRecord(n) : null;
  }

  async resolveNonConformity(orgId: string, id: string, resolutionNotes: string | null): Promise<NonConformityRecord | null> {
    const existing = await this.prisma.nonConformity.findFirst({ where: { id, orgId } });
    if (!existing) return null;
    const n = await this.prisma.nonConformity.update({ where: { id }, data: { status: 'resolved', resolutionNotes } });
    return toNonConformityRecord(n);
  }

  async listActiveBatchesWithExpiry(orgId?: string): Promise<BatchRecord[]> {
    const rows = await this.prisma.batch.findMany({
      where: { status: 'active', expiryDate: { not: null }, ...(orgId ? { orgId } : {}) },
    });
    return rows.map(toBatchRecord);
  }

  async hasExpiryAlert(batchId: string): Promise<boolean> {
    const existing = await this.prisma.expiryAlert.findUnique({ where: { batchId } });
    return existing != null;
  }

  async createExpiryAlert(orgId: string, batchId: string): Promise<void> {
    await this.prisma.expiryAlert.create({ data: { orgId, batchId } });
  }

  async withTransaction<T>(fn: (tx: QualityDataPort) => Promise<T>): Promise<T> {
    if (!('$transaction' in this.prisma)) {
      return fn(this);
    }
    return (this.prisma as PrismaClient).$transaction(async (tx) => fn(new PrismaQualityDataPort(tx)));
  }
}
