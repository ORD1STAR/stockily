import { computeInvoiceTotals, computeLineAmounts } from './invoice-math.js';
import { InvalidDiscountError } from './types.js';

describe('computeLineAmounts', () => {
  it('computes gross/net/tax with no discount', () => {
    const r = computeLineAmounts({ id: 'l1', quantity: 40, unitPrice: 980, taxRatePercent: 19 });
    expect(r.grossAmount).toBe(39200);
    expect(r.discountAmount).toBe(0);
    expect(r.netAmount).toBe(39200);
    expect(r.taxAmount).toBeCloseTo(7448, 2);
    expect(r.totalAmount).toBeCloseTo(46648, 2);
  });

  it('applies a percent discount before tax', () => {
    const r = computeLineAmounts({ id: 'l1', quantity: 10, unitPrice: 100, discountPercent: 10, taxRatePercent: 19 });
    expect(r.grossAmount).toBe(1000);
    expect(r.discountAmount).toBe(100);
    expect(r.netAmount).toBe(900);
    expect(r.taxAmount).toBeCloseTo(171, 2);
  });

  it('applies a fixed discount amount', () => {
    const r = computeLineAmounts({ id: 'l1', quantity: 1, unitPrice: 500, discountAmount: 50, taxRatePercent: 0 });
    expect(r.netAmount).toBe(450);
  });

  it('rejects both discountPercent and discountAmount together', () => {
    expect(() => computeLineAmounts({ id: 'l1', quantity: 1, unitPrice: 100, discountPercent: 10, discountAmount: 5 })).toThrow(
      InvalidDiscountError,
    );
  });

  it('rejects a discount larger than the line amount', () => {
    expect(() => computeLineAmounts({ id: 'l1', quantity: 1, unitPrice: 100, discountAmount: 150 })).toThrow(InvalidDiscountError);
  });

  it('rejects an out-of-range discount percent', () => {
    expect(() => computeLineAmounts({ id: 'l1', quantity: 1, unitPrice: 100, discountPercent: 150 })).toThrow(InvalidDiscountError);
  });

  it('treats a missing tax rate as 0%', () => {
    const r = computeLineAmounts({ id: 'l1', quantity: 2, unitPrice: 100 });
    expect(r.taxAmount).toBe(0);
    expect(r.totalAmount).toBe(200);
  });
});

describe('computeInvoiceTotals', () => {
  it('sums the wireframe demo invoice lines (docs/Wireframes.html FA-2026-000184) internally consistently', () => {
    // The wireframe's own displayed total (48 139,00) and amount-in-words
    // were hand-typed static mockup content — 40 700 HT * 1.19 is actually
    // 48 433, not 48 139, so that mockup was never internally consistent to
    // begin with. This test doesn't try to reproduce that placeholder
    // number; it checks OUR math is self-consistent (HT + TVA sums to TTC)
    // using the same two line items.
    const totals = computeInvoiceTotals([
      { id: 'l1', quantity: 40, unitPrice: 980, taxRatePercent: 19 },
      { id: 'l2', quantity: 1, unitPrice: 1500, taxRatePercent: 19 },
    ]);
    expect(totals.totalHt).toBeCloseTo(40700, 2);
    expect(totals.totalTtc).toBeCloseTo(48433, 2);
    const sumOfLineTotals = totals.lines.reduce((s, l) => s + l.totalAmount, 0);
    expect(totals.totalTtc).toBeCloseTo(sumOfLineTotals, 2);
  });

  it('sums an empty line list to zero without throwing', () => {
    const totals = computeInvoiceTotals([]);
    expect(totals).toEqual({ lines: [], totalHt: 0, totalTax: 0, totalTtc: 0 });
  });
});
