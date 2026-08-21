import type { BatchRecord, CreateBatchInput, NonConformityRecord, QualityCheckRecord } from './types.js';

export interface ProductRecord {
  id: string;
  isLotTracked: boolean;
}

export interface InsertQualityCheckInput {
  orgId: string;
  productId: string;
  batchId: string | null;
  result: 'conforme' | 'non_conforme';
  notes: string | null;
  checkedBy: string | null;
}

export interface InsertNonConformityInput {
  orgId: string;
  productId: string;
  batchId: string | null;
  severity: string;
}

/**
 * The seam between `domain-quality` (pure logic) and Prisma
 * (packages/infra-db/src/lib/prisma-quality-data-port.ts) — mirrors
 * @org/domain-stock's StockDataPort split (docs/Action Plan.md §6).
 */
export interface QualityDataPort {
  getProduct(orgId: string, productId: string): Promise<ProductRecord | null>;

  createBatch(input: CreateBatchInput): Promise<BatchRecord>;
  getBatch(orgId: string, batchId: string): Promise<BatchRecord | null>;
  listBatches(orgId: string, filters?: { productId?: string }): Promise<BatchRecord[]>;
  updateBatchStatus(batchId: string, status: 'active' | 'quarantined' | 'depleted'): Promise<void>;

  /**
   * Per-site remaining on-hand quantity for a batch, derived from the
   * `stock_movements` ledger — `StockLevel` only aggregates per
   * product+site, not per batch, so this has to be reconstructed from raw
   * movement rows. See docs/MILESTONE_3.md for the exact derivation and its
   * one known limitation (unlinked TRANSFERs, which no current code path
   * produces). Returns only sites with a positive remaining quantity.
   */
  getBatchQuantityBySite(orgId: string, batchId: string): Promise<Map<string, number>>;

  insertQualityCheck(input: InsertQualityCheckInput): Promise<QualityCheckRecord>;
  listQualityChecks(orgId: string, filters: { batchId?: string; productId?: string }): Promise<QualityCheckRecord[]>;

  insertNonConformity(input: InsertNonConformityInput): Promise<NonConformityRecord>;
  listNonConformities(orgId: string, status?: 'open' | 'resolved'): Promise<NonConformityRecord[]>;
  getNonConformity(orgId: string, id: string): Promise<NonConformityRecord | null>;
  resolveNonConformity(orgId: string, id: string, resolutionNotes: string | null): Promise<NonConformityRecord | null>;

  /** Active batches with an expiryDate set — candidates for the near-expiry / auto-quarantine sweep. */
  listActiveBatchesWithExpiry(orgId?: string): Promise<BatchRecord[]>;
  hasExpiryAlert(batchId: string): Promise<boolean>;
  createExpiryAlert(orgId: string, batchId: string): Promise<void>;

  /** Runs `fn` with a port bound to a single DB transaction. */
  withTransaction<T>(fn: (tx: QualityDataPort) => Promise<T>): Promise<T>;
}
