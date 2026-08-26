import type { StockDataPort } from './stock-data.port.js';
import { computeThresholdStatus } from './threshold.js';
import {
  InsufficientQuarantineSourceError,
  InsufficientReservableStockError,
  NegativeStockError,
  QuarantineInput,
  QuarantineResult,
  RecordMovementInput,
  RecordMovementResult,
  ReleaseInput,
  ReleaseResult,
  ReserveInput,
  ReserveResult,
  StockDomainEvent,
  UnknownProductError,
} from './types.js';

/**
 * Stock's public service contract (docs/Action Plan.md §1/§5/§6). Every
 * cross-module integration point — Quality's quarantine call, Invoicing's
 * OUT movement on a finalized line, Scan's movement-from-a-barcode, a future
 * Achats receipt — goes through these two methods, never by writing to
 * `stock_levels`/`stock_movements` directly. Framework-agnostic: takes a
 * `StockDataPort` (implemented against Prisma in packages/infra-db), no
 * Nest/HTTP import here.
 */
export class StockMovementService {
  constructor(private readonly data: StockDataPort) {}

  async recordMovement(input: RecordMovementInput): Promise<RecordMovementResult> {
    if (input.quantity <= 0) {
      throw new RangeError(`quantity must be positive, got ${input.quantity}`);
    }
    if (input.type === 'TRANSFER' && (!input.toSiteId || input.toSiteId === input.siteId)) {
      throw new RangeError('TRANSFER requires a toSiteId different from siteId');
    }
    if (input.type === 'ADJUSTMENT' && !input.adjustmentDirection) {
      throw new RangeError('ADJUSTMENT requires adjustmentDirection ("increase" | "decrease")');
    }

    return this.data.withTransaction(async (tx) => {
      const product = await tx.getProduct(input.orgId, input.productId);
      if (!product) throw new UnknownProductError(input.productId);

      const increasesOnHand = input.type === 'IN' || (input.type === 'ADJUSTMENT' && input.adjustmentDirection === 'increase');
      const decreasesOnHand =
        input.type === 'OUT' || input.type === 'TRANSFER' || (input.type === 'ADJUSTMENT' && input.adjustmentDirection === 'decrease');

      const before = await tx.getOrCreateStockLevel(input.productId, input.siteId);

      // Reservations (Gestion Ventes' commande stock-hold) only constrain
      // real consumption/movement of goods — OUT and TRANSFER. ADJUSTMENT
      // corrects the ledger to physical reality (a recount), which must
      // stay bounded only by true physical on-hand, not by what's
      // earmarked for someone else — an adjustment that "eats into" a
      // reservation is exactly the case an adjustment exists to surface,
      // not something it should be blocked from recording.
      const reservationAware = input.type === 'OUT' || input.type === 'TRANSFER';
      const cap = reservationAware ? before.quantityOnHand - before.quantityReserved : before.quantityOnHand;
      if (decreasesOnHand && input.quantity > cap) {
        throw new NegativeStockError(input.productId, input.siteId, input.quantity, cap);
      }

      const delta = increasesOnHand ? input.quantity : decreasesOnHand ? -input.quantity : 0;
      const fromStockLevel = await tx.applyStockLevelDelta(input.productId, input.siteId, { onHand: delta });

      // Weighted Average Cost (§9 decision #1) — IN only, and only when a
      // unit cost was actually supplied (a caller that doesn't know the
      // cost, e.g. a scan-triggered IN with no invoice behind it yet, simply
      // leaves the running average untouched rather than corrupting it with
      // an assumed zero cost).
      if (input.type === 'IN' && input.unitCost != null) {
        const priorOnHand = before.quantityOnHand;
        const newOnHand = priorOnHand + input.quantity;
        const newAverageCost =
          newOnHand === 0 ? product.averageCost : (product.averageCost * priorOnHand + input.unitCost * input.quantity) / newOnHand;
        await tx.updateAverageCost(input.productId, newAverageCost);
      }

      const movement = await tx.insertMovement({
        orgId: input.orgId,
        productId: input.productId,
        siteId: input.siteId,
        type: input.type,
        quantity: input.quantity,
        batchId: input.batchId ?? null,
        partnerId: input.partnerId ?? null,
        relatedEntityType: input.relatedEntityType ?? null,
        relatedEntityId: input.relatedEntityId ?? null,
        performedBy: input.performedBy ?? null,
      });

      const events: StockDomainEvent[] = [
        {
          kind: 'StockMovementCreated',
          orgId: input.orgId,
          siteId: input.siteId,
          productId: input.productId,
          movementType: input.type,
          quantity: input.quantity,
          movementId: movement.id,
          occurredAt: movement.occurredAt.toISOString(),
        },
      ];

      if (decreasesOnHand) {
        this.pushLowStockEventIfNewlyCrossed(events, before.quantityOnHand, fromStockLevel.quantityOnHand, product.minThreshold, {
          orgId: input.orgId,
          siteId: input.siteId,
          productId: input.productId,
          occurredAt: movement.occurredAt.toISOString(),
        });
      }

      const result: RecordMovementResult = { movementId: movement.id, fromStockLevel, events };

      // TRANSFER's second leg: the destination site's own product row and
      // stock level (created on first use — getOrCreateStockLevel), the
      // same batch/relatedEntity, no cost recalculation (a transfer doesn't
      // change the org's total cost basis, only where the units physically
      // are).
      if (input.type === 'TRANSFER' && input.toSiteId) {
        await tx.getOrCreateStockLevel(input.productId, input.toSiteId);
        const toStockLevel = await tx.applyStockLevelDelta(input.productId, input.toSiteId, { onHand: input.quantity });
        const destMovement = await tx.insertMovement({
          orgId: input.orgId,
          productId: input.productId,
          siteId: input.toSiteId,
          type: 'TRANSFER',
          quantity: input.quantity,
          batchId: input.batchId ?? null,
          relatedEntityType: input.relatedEntityType ?? null,
          relatedEntityId: input.relatedEntityId ?? null,
          performedBy: input.performedBy ?? null,
        });

        result.transferMovementId = destMovement.id;
        result.toStockLevel = toStockLevel;
        events.push({
          kind: 'StockMovementCreated',
          orgId: input.orgId,
          siteId: input.toSiteId,
          productId: input.productId,
          movementType: 'TRANSFER',
          quantity: input.quantity,
          movementId: destMovement.id,
          occurredAt: destMovement.occurredAt.toISOString(),
        });
      }

      return result;
    });
  }

  /**
   * Reclassifies already-on-hand quantity as quarantined — the exact seam
   * Quality (failed check / expired batch) calls (§5/§9 decision #6).
   * Deliberately does NOT create a `StockMovement` row: nothing entered or
   * left the site and the total (onHand + quarantined) is unchanged, only
   * its sellable/non-sellable classification — the `audit_log` (via the
   * caller's own `@Audit(...)` on its mutating endpoint) and the
   * `StockQuarantined` event below are the traceability trail for this, not
   * the movement ledger.
   */
  async quarantine(input: QuarantineInput): Promise<QuarantineResult> {
    if (input.quantity <= 0) {
      throw new RangeError(`quantity must be positive, got ${input.quantity}`);
    }

    return this.data.withTransaction(async (tx) => {
      const product = await tx.getProduct(input.orgId, input.productId);
      if (!product) throw new UnknownProductError(input.productId);

      const before = await tx.getOrCreateStockLevel(input.productId, input.siteId);
      if (input.quantity > before.quantityOnHand) {
        throw new InsufficientQuarantineSourceError(input.productId, input.siteId, input.quantity, before.quantityOnHand);
      }

      const stockLevel = await tx.applyStockLevelDelta(input.productId, input.siteId, {
        onHand: -input.quantity,
        quarantined: input.quantity,
      });

      return {
        stockLevel,
        events: [
          {
            kind: 'StockQuarantined',
            orgId: input.orgId,
            siteId: input.siteId,
            productId: input.productId,
            quantity: input.quantity,
            reason: input.reason,
            occurredAt: new Date().toISOString(),
          },
        ],
      };
    });
  }

  /**
   * Earmarks already-on-hand quantity against a future OUT/TRANSFER
   * (Gestion Ventes' commande) — `quantityReserved`, stubbed since
   * Milestone 1, finally wired up here. Same shape as `quarantine`:
   * reclassifies existing stock, never creates a `StockMovement` row
   * (nothing has moved yet). Strict by default — `allowBackorder: true`
   * lets the caller (already holding the user's explicit acknowledgement
   * of a shortage) reserve past what's actually available.
   */
  async reserve(input: ReserveInput): Promise<ReserveResult> {
    if (input.quantity <= 0) {
      throw new RangeError(`quantity must be positive, got ${input.quantity}`);
    }

    return this.data.withTransaction(async (tx) => {
      const product = await tx.getProduct(input.orgId, input.productId);
      if (!product) throw new UnknownProductError(input.productId);

      const before = await tx.getOrCreateStockLevel(input.productId, input.siteId);
      const available = before.quantityOnHand - before.quantityReserved;
      const backorderedQuantity = Math.max(0, input.quantity - available);

      if (backorderedQuantity > 0 && !input.allowBackorder) {
        throw new InsufficientReservableStockError(input.productId, input.siteId, input.quantity, available);
      }

      const stockLevel = await tx.applyStockLevelDelta(input.productId, input.siteId, { reserved: input.quantity });

      return {
        stockLevel,
        backorderedQuantity,
        events: [
          {
            kind: 'StockReserved',
            orgId: input.orgId,
            siteId: input.siteId,
            productId: input.productId,
            quantity: input.quantity,
            backorderedQuantity,
            occurredAt: new Date().toISOString(),
          },
        ],
      };
    });
  }

  /** Releases a previously-reserved quantity — a commande being (partially) invoiced or cancelled. Floored at 0 defensively; the caller is expected to only ever release `quantityOrdered - quantityInvoiced`, but this primitive doesn't trust that blindly. */
  async release(input: ReleaseInput): Promise<ReleaseResult> {
    if (input.quantity <= 0) {
      throw new RangeError(`quantity must be positive, got ${input.quantity}`);
    }

    return this.data.withTransaction(async (tx) => {
      const product = await tx.getProduct(input.orgId, input.productId);
      if (!product) throw new UnknownProductError(input.productId);

      const before = await tx.getOrCreateStockLevel(input.productId, input.siteId);
      const releaseQuantity = Math.min(input.quantity, before.quantityReserved);

      const stockLevel = await tx.applyStockLevelDelta(input.productId, input.siteId, { reserved: -releaseQuantity });

      return {
        stockLevel,
        events: [
          {
            kind: 'StockReleased',
            orgId: input.orgId,
            siteId: input.siteId,
            productId: input.productId,
            quantity: releaseQuantity,
            occurredAt: new Date().toISOString(),
          },
        ],
      };
    });
  }

  private pushLowStockEventIfNewlyCrossed(
    events: StockDomainEvent[],
    priorOnHand: number,
    newOnHand: number,
    minThreshold: number | null,
    ctx: { orgId: string; siteId: string; productId: string; occurredAt: string },
  ): void {
    if (minThreshold == null) return;
    const wasOk = computeThresholdStatus(priorOnHand, minThreshold) === 'ok';
    const isNowCrossed = computeThresholdStatus(newOnHand, minThreshold) !== 'ok';
    // Only fire on the ok -> (low|out) transition, not on every movement
    // while already below threshold — a Notifications module (Phase 2)
    // consuming this event should see one alert per crossing, not a flood.
    if (wasOk && isNowCrossed) {
      events.push({
        kind: 'StockLevelLow',
        orgId: ctx.orgId,
        siteId: ctx.siteId,
        productId: ctx.productId,
        quantityOnHand: newOnHand,
        minThreshold,
        occurredAt: ctx.occurredAt,
      });
    }
  }
}
