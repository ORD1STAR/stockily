// Public domain types for Quality. Framework-agnostic (no Nest/Express/Prisma
// imports), per docs/Action Plan.md §6 — same discipline as @org/domain-stock.
// This package does NOT import @org/domain-stock: the ESLint depConstraints
// (eslint.config.mjs) allow scope:domain -> scope:domain, so it *could*, but
// quarantine orchestration deliberately lives one layer up, in apps/api's
// QualityService, which already holds the one-and-only StockService
// reference (see docs/MILESTONE_3.md "Why quarantine isn't called from
// here"). This package only decides *that* and *how much* needs
// quarantining, expressed as plain data in its results — never performs it.

export interface BatchRecord {
  id: string;
  orgId: string;
  productId: string;
  lotNumber: string;
  expiryDate: string | null; // ISO date, not Date — stable wire shape (mirrors @org/domain-stock's convention)
  quantityReceived: number;
  receivedAt: string;
  status: 'active' | 'quarantined' | 'depleted';
}

export interface CreateBatchInput {
  orgId: string;
  productId: string;
  lotNumber: string;
  expiryDate?: string | null;
  quantityReceived: number;
}

/** One site where a batch currently has remaining on-hand quantity, per the ledger-derived split (see QualityDataPort.getBatchQuantityBySite). */
export interface QuarantineTarget {
  siteId: string;
  quantity: number;
}

export interface QualityCheckRecord {
  id: string;
  orgId: string;
  productId: string;
  batchId: string | null;
  checkedBy: string | null;
  result: 'conforme' | 'non_conforme';
  notes: string | null;
  checkedAt: string;
}

/**
 * Two real paths, both real user actions (§9 decision, explicit correction
 * from the user during planning — a quality check is NOT limited to
 * lot-tracked products):
 *  - batch-based: `batchId` set, `siteId`/`quantity` omitted — remaining
 *    quantity-to-quarantine-on-failure is derived from the ledger across
 *    every site currently holding that batch.
 *  - product-direct: `batchId` omitted, `siteId`+`quantity` REQUIRED — there
 *    is no batch to derive a site/quantity from (e.g. a belt with a
 *    delivery-defect inspection), so the caller must state exactly what
 *    they're inspecting.
 * Exactly one shape is valid per call; recordQualityCheck throws if both or
 * neither are satisfied.
 */
export type RecordQualityCheckInput =
  | {
      orgId: string;
      productId: string;
      batchId: string;
      siteId?: undefined;
      quantity?: undefined;
      result: 'conforme' | 'non_conforme';
      notes?: string | null;
      checkedBy?: string | null;
    }
  | {
      orgId: string;
      productId: string;
      batchId?: undefined;
      siteId: string;
      quantity: number;
      result: 'conforme' | 'non_conforme';
      notes?: string | null;
      checkedBy?: string | null;
    };

export interface RecordQualityCheckResult {
  check: QualityCheckRecord;
  /** Present only when `result === 'non_conforme'` — the non-conformity auto-opened as part of this check (§ see recordQualityCheck doc comment: there is no separate "create non-conformity" action). */
  nonConformity: NonConformityRecord | null;
  /** Empty when the check passed. One entry per site currently holding the batch (batch-based path), or exactly the caller-provided site (product-direct path). apps/api's QualityService is responsible for actually calling StockService.quarantine for each of these. */
  quarantineTargets: QuarantineTarget[];
  events: QualityDomainEvent[];
}

export interface NonConformityRecord {
  id: string;
  orgId: string;
  productId: string;
  batchId: string | null;
  severity: string;
  status: 'open' | 'resolved';
  resolutionNotes: string | null;
  createdAt: string;
}

export interface ExpiryAlertRecord {
  id: string;
  orgId: string;
  batchId: string;
  alertedAt: string;
}

/** Result of one sweep pass (see ExpirySweepService) — a report, not a side-effect-free query: running it DOES create alerts/quarantine as a side effect, this is just what happened. */
export interface ExpirySweepResult {
  newAlerts: ExpiryAlertRecord[];
  /** Batches whose expiry passed during this sweep — already marked 'quarantined', already quarantined at every site holding them. */
  autoQuarantined: { batch: BatchRecord; targets: QuarantineTarget[] }[];
  events: QualityDomainEvent[];
}

export type QualityDomainEvent =
  | { kind: 'NonConformityOpened'; orgId: string; productId: string; batchId: string | null; nonConformityId: string; severity: string; occurredAt: string }
  | { kind: 'BatchNearExpiry'; orgId: string; productId: string; batchId: string; expiryDate: string; occurredAt: string }
  | { kind: 'BatchExpired'; orgId: string; productId: string; batchId: string; occurredAt: string };

export class UnknownProductError extends Error {
  constructor(public readonly productId: string) {
    super(`Produit inconnu : ${productId}`);
    this.name = 'UnknownProductError';
  }
}

export class UnknownBatchError extends Error {
  constructor(public readonly batchId: string) {
    super(`Lot inconnu : ${batchId}`);
    this.name = 'UnknownBatchError';
  }
}

export class InvalidQualityCheckInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidQualityCheckInputError';
  }
}

export class NonConformityAlreadyResolvedError extends Error {
  constructor(public readonly nonConformityId: string) {
    super(`Non-conformité déjà résolue : ${nonConformityId}`);
    this.name = 'NonConformityAlreadyResolvedError';
  }
}

export class UnknownNonConformityError extends Error {
  constructor(public readonly nonConformityId: string) {
    super(`Non-conformité inconnue : ${nonConformityId}`);
    this.name = 'UnknownNonConformityError';
  }
}

/**
 * Placeholder default — a fixed constant, not an env var, same reasoning as
 * @org/domain-stock has none of its own but AuthService's TRIAL_DAYS does:
 * this is a business rule that happens to not be configurable *yet*, not a
 * deployment concern. Revisit as a per-org setting once there's a settings
 * surface to put it in (none exists in Phase 1 yet).
 */
export const NEAR_EXPIRY_DAYS = 30;
