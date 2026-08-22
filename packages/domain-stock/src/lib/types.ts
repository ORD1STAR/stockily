// Public domain types for Stock. Framework-agnostic (no Nest/Express/Prisma
// imports) so this stays usable by a future Local/Electron adaptation
// (docs/Action Plan.md §6) — quantities/costs are plain numbers, not
// Prisma's Decimal, and dates are ISO strings on events (a stable wire
// shape) but real Dates on inputs (caller's choice, not serialized yet).

export type StockMovementType = 'IN' | 'OUT' | 'TRANSFER' | 'ADJUSTMENT';

export interface StockLevelSnapshot {
  quantityOnHand: number;
  quantityQuarantined: number;
  quantityReserved: number;
}

export interface RecordMovementInput {
  orgId: string;
  productId: string;
  /** Source site for IN/OUT/ADJUSTMENT; source site for TRANSFER (see toSiteId). */
  siteId: string;
  type: StockMovementType;
  /** Always positive — direction is implied by `type`, never by sign. */
  quantity: number;
  batchId?: string | null;
  /** The supplier an IN was received from, or the customer an OUT was sold to — optional, no meaning for TRANSFER/ADJUSTMENT. */
  partnerId?: string | null;
  /** IN only. Feeds the Weighted Average Cost recalculation (§9 decision #1); ignored for other types. */
  unitCost?: number | null;
  /** TRANSFER only — the destination site. */
  toSiteId?: string | null;
  /** ADJUSTMENT only, required for that type — `quantity` stays a positive magnitude, this says which way the count correction goes (a physical inventory count found more, or found less, than the ledger said). */
  adjustmentDirection?: 'increase' | 'decrease';
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  performedBy?: string | null;
}

export interface RecordMovementResult {
  movementId: string;
  /** The movement created for a TRANSFER's destination leg (see stock-movement.service.ts). */
  transferMovementId?: string;
  fromStockLevel: StockLevelSnapshot;
  /** Present only for TRANSFER. */
  toStockLevel?: StockLevelSnapshot;
  events: StockDomainEvent[];
}

export interface QuarantineInput {
  orgId: string;
  productId: string;
  siteId: string;
  quantity: number;
  batchId?: string | null;
  reason: string;
  performedBy?: string | null;
}

export interface QuarantineResult {
  stockLevel: StockLevelSnapshot;
  events: StockDomainEvent[];
}

/**
 * Stable wire shape for cross-module/websocket consumption (§4/§5) — Phase
 * 2/3 modules and the realtime gateway subscribe to these, so changing a
 * field name here is a breaking change for code this package can't see.
 */
export type StockDomainEvent =
  | {
      kind: 'StockMovementCreated';
      orgId: string;
      siteId: string;
      productId: string;
      movementType: StockMovementType;
      quantity: number;
      movementId: string;
      occurredAt: string;
    }
  | {
      kind: 'StockQuarantined';
      orgId: string;
      siteId: string;
      productId: string;
      quantity: number;
      reason: string;
      occurredAt: string;
    }
  | {
      kind: 'StockLevelLow';
      orgId: string;
      siteId: string;
      productId: string;
      quantityOnHand: number;
      minThreshold: number;
      occurredAt: string;
    };

export class NegativeStockError extends Error {
  constructor(
    public readonly productId: string,
    public readonly siteId: string,
    public readonly requested: number,
    public readonly available: number,
  ) {
    super(
      `Movement would take stock negative for product ${productId} at site ${siteId}: requested ${requested}, only ${available} available.`,
    );
    this.name = 'NegativeStockError';
  }
}

export class UnknownProductError extends Error {
  constructor(public readonly productId: string) {
    super(`Unknown product: ${productId}`);
    this.name = 'UnknownProductError';
  }
}

export class InsufficientQuarantineSourceError extends Error {
  constructor(
    public readonly productId: string,
    public readonly siteId: string,
    public readonly requested: number,
    public readonly available: number,
  ) {
    super(
      `Cannot quarantine ${requested} of product ${productId} at site ${siteId}: only ${available} on hand.`,
    );
    this.name = 'InsufficientQuarantineSourceError';
  }
}
