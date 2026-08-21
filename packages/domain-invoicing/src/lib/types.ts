// Public domain types for Invoicing. Framework-agnostic (no Nest/Express/
// Prisma imports) — same discipline as @org/domain-stock (docs/Action
// Plan.md §6): plain numbers, not Prisma's Decimal.

export interface InvoiceLineInput {
  id: string;
  quantity: number;
  unitPrice: number;
  discountPercent?: number | null;
  discountAmount?: number | null;
  /** Percent, e.g. 19 for 19% — resolved from the line's TaxRate by the caller before this package sees it (domain-invoicing has no DB access). */
  taxRatePercent?: number | null;
}

export interface LineAmounts {
  lineId: string;
  /** quantity * unitPrice, before any discount. */
  grossAmount: number;
  discountAmount: number;
  /** grossAmount - discountAmount. */
  netAmount: number;
  taxAmount: number;
  /** netAmount + taxAmount. */
  totalAmount: number;
}

export interface InvoiceTotals {
  lines: LineAmounts[];
  totalHt: number;
  totalTax: number;
  totalTtc: number;
}

export class InvalidDiscountError extends Error {
  constructor(lineId: string, message: string) {
    super(`Invalid discount on line ${lineId}: ${message}`);
    this.name = 'InvalidDiscountError';
  }
}

export class OverpaymentError extends Error {
  constructor(
    public readonly invoiceId: string,
    public readonly attempted: number,
    public readonly remainingBalance: number,
  ) {
    super(`Payment of ${attempted} exceeds remaining balance of ${remainingBalance} for invoice ${invoiceId}.`);
    this.name = 'OverpaymentError';
  }
}

export type InvoiceStatus = 'draft' | 'unpaid' | 'partially_paid' | 'paid' | 'void';

/** Given total paid so far against an invoice total, what status it implies. Pure — the caller persists it. */
export function deriveInvoiceStatus(totalTtc: number, totalPaid: number): Exclude<InvoiceStatus, 'draft' | 'void'> {
  // Rounding-tolerant equality (currency arithmetic in floats) — see
  // computeInvoiceTotals's own rounding note in invoice-math.ts.
  const EPSILON = 0.01;
  if (totalPaid >= totalTtc - EPSILON) return 'paid';
  if (totalPaid > EPSILON) return 'partially_paid';
  return 'unpaid';
}
