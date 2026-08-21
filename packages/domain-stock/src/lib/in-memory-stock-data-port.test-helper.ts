import type { InsertedMovement, InsertMovementInput, ProductRecord, StockDataPort } from './stock-data.port.js';
import type { StockLevelSnapshot } from './types.js';

/**
 * A fake `StockDataPort` for unit-testing `StockMovementService` without a
 * database — this milestone's e2e test (apps/api) exercises the real Prisma
 * implementation; these unit tests exist to pin down the pure business
 * logic (weighted average cost, negative-stock rejection, threshold
 * crossing) fast and in isolation.
 */
export class InMemoryStockDataPort implements StockDataPort {
  products = new Map<string, ProductRecord>();
  levels = new Map<string, StockLevelSnapshot>();
  movements: (InsertMovementInput & InsertedMovement)[] = [];
  private nextId = 1;

  private levelKey(productId: string, siteId: string): string {
    return `${productId}:${siteId}`;
  }

  seedProduct(product: ProductRecord): void {
    this.products.set(product.id, product);
  }

  seedStockLevel(productId: string, siteId: string, snapshot: StockLevelSnapshot): void {
    this.levels.set(this.levelKey(productId, siteId), snapshot);
  }

  async getProduct(_orgId: string, productId: string): Promise<ProductRecord | null> {
    return this.products.get(productId) ?? null;
  }

  async getOrCreateStockLevel(productId: string, siteId: string): Promise<StockLevelSnapshot> {
    const key = this.levelKey(productId, siteId);
    let level = this.levels.get(key);
    if (!level) {
      level = { quantityOnHand: 0, quantityQuarantined: 0, quantityReserved: 0 };
      this.levels.set(key, level);
    }
    return { ...level };
  }

  async applyStockLevelDelta(
    productId: string,
    siteId: string,
    delta: { onHand?: number; quarantined?: number },
  ): Promise<StockLevelSnapshot> {
    const key = this.levelKey(productId, siteId);
    const current = this.levels.get(key) ?? { quantityOnHand: 0, quantityQuarantined: 0, quantityReserved: 0 };
    const updated: StockLevelSnapshot = {
      quantityOnHand: current.quantityOnHand + (delta.onHand ?? 0),
      quantityQuarantined: current.quantityQuarantined + (delta.quarantined ?? 0),
      quantityReserved: current.quantityReserved,
    };
    this.levels.set(key, updated);
    return { ...updated };
  }

  async updateAverageCost(productId: string, newAverageCost: number): Promise<void> {
    const product = this.products.get(productId);
    if (product) product.averageCost = newAverageCost;
  }

  async insertMovement(data: InsertMovementInput): Promise<InsertedMovement> {
    const inserted = { ...data, id: `mv-${this.nextId++}`, occurredAt: new Date() };
    this.movements.push(inserted);
    return { id: inserted.id, occurredAt: inserted.occurredAt };
  }

  // In-memory: nothing to actually roll back on throw, but callers rely on
  // `withTransaction` awaiting `fn` and propagating its rejection, which a
  // plain async call already does — no special-casing needed for the fake.
  async withTransaction<T>(fn: (tx: StockDataPort) => Promise<T>): Promise<T> {
    return fn(this);
  }
}
