import { InvalidDiscountError, InvoiceLineInput, InvoiceTotals, LineAmounts } from './types.js';

/**
 * Line-level discounts (percent OR fixed amount, applied before tax — Action
 * Plan §9 decision #7) and per-line tax, then summed. Pure function — no
 * DB, no Prisma.Decimal; rounding is done once per line (to the centime, 2
 * decimal places — DZD's smallest unit) rather than accumulating float
 * error across many lines and rounding only the grand total.
 */
export function computeLineAmounts(line: InvoiceLineInput): LineAmounts {
  const grossAmount = round2(line.quantity * line.unitPrice);

  if (line.discountPercent != null && line.discountAmount != null) {
    throw new InvalidDiscountError(line.id, 'specify discountPercent or discountAmount, not both');
  }
  if (line.discountPercent != null && (line.discountPercent < 0 || line.discountPercent > 100)) {
    throw new InvalidDiscountError(line.id, `discountPercent must be within 0-100, got ${line.discountPercent}`);
  }

  const discountAmount =
    line.discountAmount != null
      ? round2(line.discountAmount)
      : line.discountPercent != null
        ? round2(grossAmount * (line.discountPercent / 100))
        : 0;

  if (discountAmount > grossAmount) {
    throw new InvalidDiscountError(line.id, `discount ${discountAmount} exceeds line amount ${grossAmount}`);
  }

  const netAmount = round2(grossAmount - discountAmount);
  const taxAmount = round2(netAmount * ((line.taxRatePercent ?? 0) / 100));
  const totalAmount = round2(netAmount + taxAmount);

  return { lineId: line.id, grossAmount, discountAmount, netAmount, taxAmount, totalAmount };
}

export function computeInvoiceTotals(lines: InvoiceLineInput[]): InvoiceTotals {
  const computed = lines.map(computeLineAmounts);
  return {
    lines: computed,
    totalHt: round2(computed.reduce((sum, l) => sum + l.netAmount, 0)),
    totalTax: round2(computed.reduce((sum, l) => sum + l.taxAmount, 0)),
    totalTtc: round2(computed.reduce((sum, l) => sum + l.totalAmount, 0)),
  };
}

// Currency math in JS floats always needs a rounding boundary somewhere —
// this is it, applied per-line and again on each sum, rather than left to
// accumulate. Not using a fixed-point/Decimal library here to keep this
// package dependency-free; revisit if a future audit finds real drift.
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
