import type { StockLevelSnapshot } from './types.js';

export interface ProductRecord {
  id: string;
  isLotTracked: boolean;
  averageCost: number;
  minThreshold: number | null;
  maxThreshold: number | null;
}

export interface InsertMovementInput {
  orgId: string;
  productId: string | null;
  siteId: string;
  type: 'IN' | 'OUT' | 'TRANSFER' | 'ADJUSTMENT';
  quantity: number;
  batchId?: string | null;
  partnerId?: string | null;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  performedBy?: string | null;
}

export interface InsertedMovement {
  id: string;
  occurredAt: Date;
}

/**
 * The seam between `domain-stock` (pure logic) and whatever actually
 * persists it (Prisma today — packages/infra-db/src/lib/prisma-stock-data-port.ts
 * — a different engine for a future Local build tomorrow, per §6). Every
 * method that mutates state is expected to run inside `withTransaction`.
 */
export interface StockDataPort {
  getProduct(orgId: string, productId: string): Promise<ProductRecord | null>;

  getOrCreateStockLevel(productId: string, siteId: string): Promise<StockLevelSnapshot>;

  /** Applies a signed delta to onHand/quarantined/reserved; returns the resulting snapshot. Never lets the caller apply a delta that isn't already validated — this is a dumb writer, not a policy enforcer. */
  applyStockLevelDelta(
    productId: string,
    siteId: string,
    delta: { onHand?: number; quarantined?: number; reserved?: number },
  ): Promise<StockLevelSnapshot>;

  updateAverageCost(productId: string, newAverageCost: number): Promise<void>;

  insertMovement(data: InsertMovementInput): Promise<InsertedMovement>;

  /** Runs `fn` with a port bound to a single DB transaction — the movement insert and both stock-level/cost writes must commit or fail together. */
  withTransaction<T>(fn: (tx: StockDataPort) => Promise<T>): Promise<T>;
}
