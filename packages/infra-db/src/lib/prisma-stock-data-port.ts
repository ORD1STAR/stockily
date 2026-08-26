import { PrismaClient, Prisma } from '@prisma/client';
import type {
  InsertedMovement,
  InsertMovementInput,
  ProductRecord,
  StockDataPort,
  StockLevelSnapshot,
} from '@org/domain-stock';
import { getCurrentTenantId } from './tenant-context.js';
import { setTenantOnTransaction } from './rls-extension.js';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

function toSnapshot(level: { quantityOnHand: Prisma.Decimal; quantityQuarantined: Prisma.Decimal; quantityReserved: Prisma.Decimal }): StockLevelSnapshot {
  return {
    quantityOnHand: Number(level.quantityOnHand),
    quantityQuarantined: Number(level.quantityQuarantined),
    quantityReserved: Number(level.quantityReserved),
  };
}

/**
 * Concrete Prisma implementation of `@org/domain-stock`'s `StockDataPort`
 * (docs/Action Plan.md §6). Lives here, not in `domain-stock`, so the domain
 * package stays Prisma-free. Works both as the top-level client (wraps its
 * own `$transaction`) and as an already-open transaction client (reused
 * as-is, since Prisma doesn't support nested interactive transactions) —
 * `withTransaction` tells the two apart at runtime via the presence of
 * `$transaction` itself.
 */
export class PrismaStockDataPort implements StockDataPort {
  constructor(private readonly prisma: PrismaLike) {}

  async getProduct(orgId: string, productId: string): Promise<ProductRecord | null> {
    const p = await this.prisma.product.findFirst({ where: { id: productId, orgId } });
    if (!p) return null;
    return {
      id: p.id,
      isLotTracked: p.isLotTracked,
      averageCost: Number(p.averageCost),
      minThreshold: p.minThreshold != null ? Number(p.minThreshold) : null,
      maxThreshold: p.maxThreshold != null ? Number(p.maxThreshold) : null,
    };
  }

  async getOrCreateStockLevel(productId: string, siteId: string): Promise<StockLevelSnapshot> {
    const level = await this.prisma.stockLevel.upsert({
      where: { productId_siteId: { productId, siteId } },
      update: {},
      create: { productId, siteId },
    });
    return toSnapshot(level);
  }

  async applyStockLevelDelta(
    productId: string,
    siteId: string,
    delta: { onHand?: number; quarantined?: number },
  ): Promise<StockLevelSnapshot> {
    const level = await this.prisma.stockLevel.update({
      where: { productId_siteId: { productId, siteId } },
      data: {
        ...(delta.onHand ? { quantityOnHand: { increment: delta.onHand } } : {}),
        ...(delta.quarantined ? { quantityQuarantined: { increment: delta.quarantined } } : {}),
      },
    });
    return toSnapshot(level);
  }

  async updateAverageCost(productId: string, newAverageCost: number): Promise<void> {
    await this.prisma.product.update({ where: { id: productId }, data: { averageCost: newAverageCost } });
  }

  async insertMovement(data: InsertMovementInput): Promise<InsertedMovement> {
    const movement = await this.prisma.stockMovement.create({
      data: {
        orgId: data.orgId,
        productId: data.productId,
        siteId: data.siteId,
        type: data.type,
        quantity: data.quantity,
        batchId: data.batchId ?? null,
        partnerId: data.partnerId ?? null,
        relatedEntityType: data.relatedEntityType ?? null,
        relatedEntityId: data.relatedEntityId ?? null,
        performedBy: data.performedBy ?? null,
      },
    });
    return { id: movement.id, occurredAt: movement.occurredAt };
  }

  async withTransaction<T>(fn: (tx: StockDataPort) => Promise<T>): Promise<T> {
    // Already inside a transaction (this.prisma is a Prisma.TransactionClient,
    // which has no $transaction of its own) — Prisma doesn't support nested
    // interactive transactions, so just reuse it rather than trying to open
    // a second one. Whoever opened THAT outer transaction is responsible for
    // its own `setTenantOnTransaction` call (see e.g. invoicing.service.ts's
    // finalize) — nothing to do here in that case.
    if (!('$transaction' in this.prisma)) {
      return fn(this);
    }
    const orgId = getCurrentTenantId();
    return (this.prisma as PrismaClient).$transaction(async (tx) => {
      // Milestone 8 (RLS) — this opens a brand-new interactive transaction,
      // which the RLS extension deliberately never auto-wraps (see
      // rls-extension.ts's doc) — has to be set explicitly, once, as this
      // transaction's own first statement. `getCurrentTenantId()` (not an
      // explicit parameter) because this is the domain layer's own
      // "ordinary single call" path (StockService.recordMovement, not the
      // ...InTransaction variant) — it has no caller-supplied orgId to
      // thread through, only whatever the request's tenant context already
      // is. Skipped when unset (a script/seed run outside the request
      // pipeline, or a root-level PrismaService with no ALS context) —
      // matches how every other query already behaves with no tenant
      // context, not a new failure mode introduced here.
      if (orgId) await setTenantOnTransaction(tx, orgId);
      return fn(new PrismaStockDataPort(tx));
    });
  }
}
