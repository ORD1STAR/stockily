/**
 * Pure, DB-free classification of a stock level against its product's
 * min/max thresholds — matches the wireframe's status pills (docs/Wireframes.html):
 * "Rupture" (0 or below min and at 0), "Bas" (at/below min but > 0), "OK".
 * A product with no min threshold configured is always "ok" — thresholds are
 * opt-in per product, not a sector-wide rule.
 */
export type ThresholdStatus = 'ok' | 'low' | 'out';

export function computeThresholdStatus(quantityOnHand: number, minThreshold: number | null): ThresholdStatus {
  if (quantityOnHand <= 0) return 'out';
  if (minThreshold != null && quantityOnHand <= minThreshold) return 'low';
  return 'ok';
}
