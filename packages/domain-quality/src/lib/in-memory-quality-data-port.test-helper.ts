import type { InsertNonConformityInput, InsertQualityCheckInput, ProductRecord, QualityDataPort } from './quality-data.port.js';
import type { BatchRecord, CreateBatchInput, NonConformityRecord, QualityCheckRecord } from './types.js';

/** A fake `QualityDataPort` for unit-testing `QualityService` without a database — mirrors @org/domain-stock's InMemoryStockDataPort test-helper. */
export class InMemoryQualityDataPort implements QualityDataPort {
  products = new Map<string, ProductRecord>();
  batches = new Map<string, BatchRecord>();
  checks: QualityCheckRecord[] = [];
  nonConformities: NonConformityRecord[] = [];
  expiryAlerts = new Set<string>(); // batchId
  /** batchId -> siteId -> quantity — test setup controls this directly rather than deriving it from a fake movement ledger, since the derivation itself is Prisma-specific (see prisma-quality-data-port.ts). */
  batchQuantities = new Map<string, Map<string, number>>();

  private nextId = 1;

  seedProduct(product: ProductRecord): void {
    this.products.set(product.id, product);
  }

  seedBatchQuantity(batchId: string, siteId: string, quantity: number): void {
    const m = this.batchQuantities.get(batchId) ?? new Map<string, number>();
    m.set(siteId, quantity);
    this.batchQuantities.set(batchId, m);
  }

  async getProduct(_orgId: string, productId: string): Promise<ProductRecord | null> {
    return this.products.get(productId) ?? null;
  }

  async createBatch(input: CreateBatchInput): Promise<BatchRecord> {
    const batch: BatchRecord = {
      id: `batch-${this.nextId++}`,
      orgId: input.orgId,
      productId: input.productId,
      lotNumber: input.lotNumber,
      expiryDate: input.expiryDate ?? null,
      quantityReceived: input.quantityReceived,
      receivedAt: new Date().toISOString(),
      status: 'active',
    };
    this.batches.set(batch.id, batch);
    return batch;
  }

  async getBatch(orgId: string, batchId: string): Promise<BatchRecord | null> {
    const b = this.batches.get(batchId);
    return b && b.orgId === orgId ? b : null;
  }

  async listBatches(orgId: string, filters?: { productId?: string }): Promise<BatchRecord[]> {
    return [...this.batches.values()].filter((b) => b.orgId === orgId && (!filters?.productId || b.productId === filters.productId));
  }

  async updateBatchStatus(batchId: string, status: 'active' | 'quarantined' | 'depleted'): Promise<void> {
    const b = this.batches.get(batchId);
    if (b) b.status = status;
  }

  async getBatchQuantityBySite(_orgId: string, batchId: string): Promise<Map<string, number>> {
    return new Map(this.batchQuantities.get(batchId) ?? []);
  }

  async insertQualityCheck(input: InsertQualityCheckInput): Promise<QualityCheckRecord> {
    const check: QualityCheckRecord = {
      id: `check-${this.nextId++}`,
      orgId: input.orgId,
      productId: input.productId,
      batchId: input.batchId,
      checkedBy: input.checkedBy,
      result: input.result,
      notes: input.notes,
      checkedAt: new Date().toISOString(),
    };
    this.checks.push(check);
    return check;
  }

  async listQualityChecks(orgId: string, filters: { batchId?: string; productId?: string }): Promise<QualityCheckRecord[]> {
    return this.checks.filter(
      (c) => c.orgId === orgId && (!filters.batchId || c.batchId === filters.batchId) && (!filters.productId || c.productId === filters.productId),
    );
  }

  async insertNonConformity(input: InsertNonConformityInput): Promise<NonConformityRecord> {
    const nc: NonConformityRecord = {
      id: `nc-${this.nextId++}`,
      orgId: input.orgId,
      productId: input.productId,
      batchId: input.batchId,
      severity: input.severity,
      status: 'open',
      resolutionNotes: null,
      createdAt: new Date().toISOString(),
    };
    this.nonConformities.push(nc);
    return nc;
  }

  async listNonConformities(orgId: string, status?: 'open' | 'resolved'): Promise<NonConformityRecord[]> {
    return this.nonConformities.filter((n) => n.orgId === orgId && (!status || n.status === status));
  }

  async getNonConformity(orgId: string, id: string): Promise<NonConformityRecord | null> {
    return this.nonConformities.find((n) => n.orgId === orgId && n.id === id) ?? null;
  }

  async resolveNonConformity(orgId: string, id: string, resolutionNotes: string | null): Promise<NonConformityRecord | null> {
    const nc = this.nonConformities.find((n) => n.orgId === orgId && n.id === id);
    if (!nc) return null;
    nc.status = 'resolved';
    nc.resolutionNotes = resolutionNotes;
    return nc;
  }

  async listActiveBatchesWithExpiry(orgId?: string): Promise<BatchRecord[]> {
    return [...this.batches.values()].filter((b) => b.status === 'active' && b.expiryDate != null && (!orgId || b.orgId === orgId));
  }

  async hasExpiryAlert(batchId: string): Promise<boolean> {
    return this.expiryAlerts.has(batchId);
  }

  async createExpiryAlert(_orgId: string, batchId: string): Promise<void> {
    this.expiryAlerts.add(batchId);
  }

  async withTransaction<T>(fn: (tx: QualityDataPort) => Promise<T>): Promise<T> {
    return fn(this);
  }
}
