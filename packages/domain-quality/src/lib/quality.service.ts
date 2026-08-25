import type { QualityDataPort } from './quality-data.port.js';
import {
  BatchRecord,
  CreateBatchInput,
  InvalidQualityCheckInputError,
  NEAR_EXPIRY_DAYS,
  NonConformityAlreadyResolvedError,
  NonConformityRecord,
  QualityDomainEvent,
  QuarantineTarget,
  RecordQualityCheckInput,
  RecordQualityCheckResult,
  ExpirySweepResult,
  UnknownBatchError,
  UnknownNonConformityError,
  UnknownProductError,
} from './types.js';

/**
 * Quality's public service contract (docs/Action Plan.md §1/§7 milestone 3).
 * Owns `Batch` end-to-end — creation (at receipt) through inspection — so
 * Scan (built next) creates a lot through THIS package, not through
 * @org/domain-stock. Framework-agnostic: takes a `QualityDataPort`
 * (implemented against Prisma in packages/infra-db), no Nest/HTTP import.
 *
 * Deliberately does not call @org/domain-stock's quarantine itself, even
 * though the depConstraints in eslint.config.mjs would technically allow a
 * scope:domain package to depend on another scope:domain package. Reasons:
 *  1. This package would then need a constructed StockMovementService,
 *     which needs a StockDataPort, which is Prisma-backed
 *     (packages/infra-db) — scope:domain is NOT allowed to depend on
 *     scope:infra, so it would have to take a pre-built StockMovementService
 *     via its own constructor anyway, which is barely different from just
 *     returning the quarantine *targets* as data and letting the caller
 *     (apps/api's QualityService) — which already holds the org's one
 *     StockService — perform the call.
 *  2. It keeps this package testable against an in-memory QualityDataPort
 *     alone, with zero knowledge of Stock's internals, matching how
 *     @org/domain-stock itself has zero knowledge of Quality.
 * So: `recordQualityCheck`/the expiry sweep return `quarantineTargets`
 * (plain data — siteId + quantity); apps/api's QualityService is the one
 * that loops over them calling StockService.quarantine.
 */
export class QualityService {
  constructor(private readonly data: QualityDataPort) {}

  async createBatch(input: CreateBatchInput): Promise<BatchRecord> {
    return this.data.withTransaction(async (tx) => {
      const product = await tx.getProduct(input.orgId, input.productId);
      if (!product) throw new UnknownProductError(input.productId);
      return tx.createBatch(input);
    });
  }

  listBatches(orgId: string, filters?: { productId?: string }): Promise<BatchRecord[]> {
    return this.data.listBatches(orgId, filters);
  }

  async getBatch(orgId: string, batchId: string): Promise<BatchRecord> {
    const batch = await this.data.getBatch(orgId, batchId);
    if (!batch) throw new UnknownBatchError(batchId);
    return batch;
  }

  /**
   * See RecordQualityCheckInput's doc comment for the two valid shapes.
   * On a `non_conforme` result: opens a NonConformity as part of THIS same
   * call (there is no separate "create non-conformity" user action — the
   * seed script (packages/infra-db/prisma/seed.ts) only grants
   * `quality.nonconformity.read`/`.resolve`, deliberately no `.create`,
   * confirming this is the intended design, not an oversight on my part),
   * and computes `quarantineTargets` — every site where this batch (or, for
   * the product-direct path, the caller-stated site) currently has
   * remaining quantity — for the caller to actually quarantine.
   */
  async recordQualityCheck(input: RecordQualityCheckInput): Promise<RecordQualityCheckResult> {
    const hasBatch = input.batchId != null;
    const hasDirect = input.siteId != null && input.quantity != null;
    if (hasBatch === hasDirect) {
      throw new InvalidQualityCheckInputError(
        'Provide exactly one of: batchId (batch-based check) or siteId+quantity (product-direct check), not both or neither.',
      );
    }

    return this.data.withTransaction(async (tx) => {
      const product = await tx.getProduct(input.orgId, input.productId);
      if (!product) throw new UnknownProductError(input.productId);

      let batch: BatchRecord | null = null;
      if (input.batchId) {
        batch = await tx.getBatch(input.orgId, input.batchId);
        if (!batch) throw new UnknownBatchError(input.batchId);
      }

      const check = await tx.insertQualityCheck({
        orgId: input.orgId,
        productId: input.productId,
        batchId: input.batchId ?? null,
        result: input.result,
        notes: input.notes ?? null,
        checkedBy: input.checkedBy ?? null,
      });

      const events: QualityDomainEvent[] = [];
      let nonConformity: NonConformityRecord | null = null;
      let quarantineTargets: QuarantineTarget[] = [];

      if (input.result === 'non_conforme') {
        nonConformity = await tx.insertNonConformity({
          orgId: input.orgId,
          productId: input.productId,
          batchId: input.batchId ?? null,
          severity: 'normal',
        });
        events.push({
          kind: 'NonConformityOpened',
          orgId: input.orgId,
          productId: input.productId,
          batchId: input.batchId ?? null,
          nonConformityId: nonConformity.id,
          severity: nonConformity.severity,
          occurredAt: nonConformity.createdAt,
        });

        if (batch) {
          await tx.updateBatchStatus(batch.id, 'quarantined');
          const bySite = await tx.getBatchQuantityBySite(input.orgId, batch.id);
          quarantineTargets = [...bySite.entries()].map(([siteId, quantity]) => ({ siteId, quantity }));
        } else if (input.siteId != null && input.quantity != null) {
          quarantineTargets = [{ siteId: input.siteId, quantity: input.quantity }];
        }
      }

      return { check, nonConformity, quarantineTargets, events };
    });
  }

  listNonConformities(orgId: string, status?: 'open' | 'resolved'): Promise<NonConformityRecord[]> {
    return this.data.listNonConformities(orgId, status);
  }

  async resolveNonConformity(orgId: string, id: string, resolutionNotes: string | null): Promise<NonConformityRecord> {
    const existing = await this.data.getNonConformity(orgId, id);
    if (!existing) throw new UnknownNonConformityError(id);
    if (existing.status === 'resolved') throw new NonConformityAlreadyResolvedError(id);

    const resolved = await this.data.resolveNonConformity(orgId, id, resolutionNotes);
    if (!resolved) throw new UnknownNonConformityError(id);
    return resolved;
  }

  /**
   * One sweep pass, meant to be invoked periodically (apps/api wires a
   * @nestjs/schedule interval — see modules/quality/expiry-sweep.scheduler.ts)
   * and is also idempotent/safe to call on-demand (e.g. from the expiry
   * alerts list endpoint, so a demo/dev environment without the scheduler
   * running still sees correct data). Two things happen per active,
   * expiry-dated batch:
   *  - within NEAR_EXPIRY_DAYS of expiry, not yet alerted: create one
   *    ExpiryAlert (never re-alerts the same batch — §3).
   *  - already past expiry: auto-quarantine every site holding it (§9
   *    decision #6 — this is enforced, not left as a dashboard warning) and
   *    mark the batch 'quarantined'.
   */
  async runExpirySweep(orgId?: string): Promise<ExpirySweepResult> {
    const batches = await this.data.listActiveBatchesWithExpiry(orgId);
    const now = Date.now();
    const nearThreshold = now + NEAR_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

    const result: ExpirySweepResult = { newAlerts: [], autoQuarantined: [], events: [] };

    for (const batch of batches) {
      if (!batch.expiryDate) continue;
      const expiryMs = new Date(batch.expiryDate).getTime();

      if (expiryMs <= now) {
        const bySite = await this.data.getBatchQuantityBySite(batch.orgId, batch.id);
        const targets = [...bySite.entries()].map(([siteId, quantity]) => ({ siteId, quantity }));
        await this.data.updateBatchStatus(batch.id, 'quarantined');
        result.autoQuarantined.push({ batch, targets });
        result.events.push({ kind: 'BatchExpired', orgId: batch.orgId, productId: batch.productId, batchId: batch.id, occurredAt: new Date().toISOString() });
        continue;
      }

      if (expiryMs <= nearThreshold) {
        const alreadyAlerted = await this.data.hasExpiryAlert(batch.id);
        if (!alreadyAlerted) {
          await this.data.createExpiryAlert(batch.orgId, batch.id);
          result.newAlerts.push({ id: '', orgId: batch.orgId, batchId: batch.id, alertedAt: new Date().toISOString() });
          result.events.push({ kind: 'BatchNearExpiry', orgId: batch.orgId, productId: batch.productId, batchId: batch.id, expiryDate: batch.expiryDate, occurredAt: new Date().toISOString() });
        }
      }
    }

    return result;
  }
}
