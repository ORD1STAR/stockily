import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerService } from '../invoicing/ledger.service';

export type Granularity = 'day' | 'week' | 'month' | 'year';
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function bucketKey(d: Date, g: Granularity): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  if (g === 'year') return `${y}`;
  if (g === 'month') return `${y}-${m}`;
  if (g === 'week') {
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
  }
  return `${y}-${m}-${String(d.getDate()).padStart(2, '0')}`;
}

function bucketsBetween(from: Date, to: Date, g: Granularity): string[] {
  const keys: string[] = [];
  const cur = new Date(from);
  let guard = 0;
  while (cur <= to && guard++ < 1000) {
    const k = bucketKey(cur, g);
    if (keys[keys.length - 1] !== k) keys.push(k);
    if (g === 'day' || g === 'week') cur.setDate(cur.getDate() + 1);
    else if (g === 'month') cur.setMonth(cur.getMonth() + 1, 1);
    else cur.setFullYear(cur.getFullYear() + 1, 0, 1);
  }
  return keys;
}

interface SaleLine {
  productId: string | null;
  name: string;
  quantity: number;
  ht: number;
  ttc: number;
}

const METHOD_LABEL: Record<string, string> = { especes: 'Espèces', carte: 'Carte', cheque: 'Chèque', virement: 'Virement', autre: 'Non précisé' };
// Older payments were recorded with free-text / English method codes.
const METHOD_ALIAS: Record<string, string> = { cash: 'especes', espece: 'especes', card: 'carte', cb: 'carte', check: 'cheque', cheque: 'cheque', transfer: 'virement', bank_transfer: 'virement', wire: 'virement' };
const normMethod = (m: string | null | undefined) => {
  const k = (m ?? '').trim().toLowerCase();
  return METHOD_LABEL[k] ? k : (METHOD_ALIAS[k] ?? 'autre');
};

/**
 * Chiffres de vente et d'achat sur une période (with the same figures for
 * the previous period of equal length, for the trend), plus the current
 * snapshot of balances and stock. Sales = bons de livraison (comptoir
 * compris) + factures directes − retours clients; purchases = bons de
 * réception + factures fournisseurs directes − retours fournisseurs.
 * Margin = product lines only, at each product's current average cost.
 */
@Injectable()
export class StatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  async overview(orgId: string, fromStr: string, toStr: string, granularity: Granularity, siteId?: string, compare?: { from: string; to: string }) {
    const from = new Date(fromStr);
    const to = new Date(toStr);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) throw new BadRequestException('Période invalide.');
    from.setHours(0, 0, 0, 0);
    to.setHours(23, 59, 59, 999);
    // Comparison period: given by the caller (same days last month / last
    // year), otherwise the period of the same length just before.
    let prevFrom: Date;
    let prevTo: Date;
    if (compare && !Number.isNaN(new Date(compare.from).getTime()) && !Number.isNaN(new Date(compare.to).getTime())) {
      prevFrom = new Date(compare.from);
      prevTo = new Date(compare.to);
      prevFrom.setHours(0, 0, 0, 0);
      prevTo.setHours(23, 59, 59, 999);
    } else {
      prevTo = new Date(from.getTime() - 1);
      prevFrom = new Date(prevTo.getTime() - (to.getTime() - from.getTime()));
      prevFrom.setHours(0, 0, 0, 0);
    }

    const [current, previous] = await Promise.all([this.flows(orgId, from, to, granularity, siteId), this.flows(orgId, prevFrom, prevTo, granularity, siteId)]);
    const [balances, stock] = await Promise.all([this.balances(orgId), this.stock(orgId, siteId)]);

    return {
      period: { from, to, granularity, previousFrom: prevFrom, previousTo: prevTo },
      ...current,
      previous: {
        salesTtc: previous.sales.totalTtc,
        margin: previous.sales.estimatedMargin,
        purchases: previous.purchases.total,
        count: previous.sales.count,
        averageBasket: previous.sales.averageBasket,
        collected: previous.payments.collected,
      },
      balances,
      stock,
    };
  }

  private async flows(orgId: string, from: Date, to: Date, granularity: Granularity, siteId?: string) {
    const site = siteId ? { siteId } : {};
    const [docs, invoices, receipts, products] = await Promise.all([
      this.prisma.tradeDocument.findMany({
        where: { orgId, status: 'validated', issuedAt: { gte: from, lte: to }, ...site },
        include: { lines: { include: { taxRate: true } }, partner: { select: { id: true, name: true } } },
      }),
      this.prisma.invoice.findMany({
        where: {
          orgId,
          deletedAt: null,
          kind: 'invoice',
          fromDocuments: false,
          status: { in: ['unpaid', 'partially_paid', 'paid'] },
          finalizedAt: { gte: from, lte: to },
          ...site,
        },
        include: { lines: { include: { taxRate: true } }, partner: { select: { id: true, name: true } }, payments: true },
      }),
      this.prisma.purchaseReceipt.findMany({
        where: { orgId, cancelledAt: null, receivedAt: { gte: from, lte: to }, ...site },
        include: { lines: true, supplier: { select: { id: true, name: true } } },
      }),
      this.prisma.product.findMany({ where: { orgId }, select: { id: true, averageCost: true } }),
    ]);
    const cost = new Map(products.map((p) => [p.id, Number(p.averageCost)]));
    const keys = bucketsBetween(from, to, granularity);
    const series = new Map(keys.map((k) => [k, { key: k, sales: 0, purchases: 0, margin: 0, count: 0 }]));
    const bucket = (d: Date) => series.get(bucketKey(d, granularity));

    let salesHt = 0;
    let salesTtc = 0;
    let saleCount = 0;
    let productHt = 0;
    let margin = 0;
    let creditCount = 0;
    let creditAmount = 0;
    const collectedBy = new Map<string, number>();
    const collect = (method: string | null, amount: number) => {
      if (amount <= 0) return;
      const m = normMethod(method);
      collectedBy.set(m, (collectedBy.get(m) ?? 0) + amount);
    };
    const byProduct = new Map<string, { name: string; quantity: number; revenue: number }>();
    const byCustomer = new Map<string, { name: string; count: number; revenue: number }>();
    const docPayments = await this.prisma.partnerPayment.findMany({ where: { orgId, cancelledAt: null, documentId: { in: docs.map((d) => d.id) } } });

    const addSale = (date: Date, partner: { id: string; name: string } | null, lines: SaleLine[], sign: 1 | -1, paid: number | null) => {
      const ht = lines.reduce((s, l) => s + l.ht, 0);
      const ttc = lines.reduce((s, l) => s + l.ttc, 0);
      let lineMargin = 0;
      for (const l of lines) {
        if (!l.productId) continue;
        productHt += sign * l.ht;
        lineMargin += sign * (l.ht - (cost.get(l.productId) ?? 0) * l.quantity);
        const p = byProduct.get(l.productId) ?? { name: l.name, quantity: 0, revenue: 0 };
        p.quantity += sign * l.quantity;
        p.revenue += sign * l.ttc;
        byProduct.set(l.productId, p);
      }
      margin += lineMargin;
      salesHt += sign * ht;
      salesTtc += sign * ttc;
      const b = bucket(date);
      if (b) {
        b.sales = round2(b.sales + sign * ttc);
        b.margin = round2(b.margin + lineMargin);
        if (sign === 1) b.count += 1;
      }
      if (sign === 1) {
        saleCount += 1;
        if (paid != null && paid + 0.01 < ttc) {
          creditCount += 1;
          creditAmount += ttc - paid;
        }
      }
      const key = partner?.id ?? 'comptoir';
      const c = byCustomer.get(key) ?? { name: partner?.name ?? 'Client comptoir', count: 0, revenue: 0 };
      if (sign === 1) c.count += 1;
      c.revenue += sign * ttc;
      byCustomer.set(key, c);
    };
    const toLines = (lines: { productId: string | null; description: string; quantity: unknown; unitPrice: unknown; discountPercent: unknown; taxRate: { rate: unknown } | null }[]): SaleLine[] =>
      lines.map((l) => {
        const qty = Number(l.quantity);
        const ht = qty * Number(l.unitPrice) * (1 - (l.discountPercent != null ? Number(l.discountPercent) : 0) / 100);
        return { productId: l.productId, name: l.description, quantity: qty, ht, ttc: ht * (1 + (l.taxRate ? Number(l.taxRate.rate) : 0) / 100) };
      });

    let purchases = 0;
    let purchaseCount = 0;
    const bySupplier = new Map<string, { name: string; count: number; amount: number }>();
    const addPurchase = (date: Date, supplier: { id: string; name: string } | null, amount: number, sign: 1 | -1) => {
      purchases += sign * amount;
      if (sign === 1) purchaseCount += 1;
      const b = bucket(date);
      if (b) b.purchases = round2(b.purchases + sign * amount);
      const key = supplier?.id ?? 'none';
      const s = bySupplier.get(key) ?? { name: supplier?.name ?? 'Non spécifié', count: 0, amount: 0 };
      if (sign === 1) s.count += 1;
      s.amount += sign * amount;
      bySupplier.set(key, s);
    };

    for (const d of docs) {
      const lines = toLines(d.lines);
      if (d.type === 'delivery_note') {
        let paid: number | null = null;
        if (d.counterSessionId) {
          // A comptoir sale: what was cashed at the till.
          paid = Number(d.amountPaidAtCounter);
          collect(d.paymentMethod, paid);
        } else if (d.partnerId) {
          const pays = docPayments.filter((p) => p.documentId === d.id && p.direction === 'in');
          paid = pays.reduce((s, p) => s + Number(p.amount), 0);
          for (const p of pays) collect(p.method, Number(p.amount));
        }
        addSale(d.issuedAt, d.partner, lines, 1, paid);
      } else if (d.type === 'customer_return') addSale(d.issuedAt, d.partner, lines, -1, null);
      else if (d.type === 'supplier_return') addPurchase(d.issuedAt, d.partner, lines.reduce((s, l) => s + l.ttc, 0), -1);
    }
    for (const inv of invoices) {
      const lines = toLines(inv.lines);
      if (inv.type === 'CUSTOMER') {
        const paid = inv.payments.reduce((s, p) => s + Number(p.amount), 0);
        for (const p of inv.payments) collect(p.method || (inv.paymentMode !== 'terme' ? inv.paymentMode : null), Number(p.amount));
        addSale(inv.finalizedAt ?? inv.issuedAt, inv.partner, lines, 1, paid);
      } else addPurchase(inv.finalizedAt ?? inv.issuedAt, inv.partner, lines.reduce((s, l) => s + l.ttc, 0), 1);
    }
    for (const r of receipts) addPurchase(r.receivedAt, r.supplier, LedgerService.receiptTotal(r.lines), 1);

    const collected = round2([...collectedBy.values()].reduce((s, v) => s + v, 0));
    const topN = <T>(m: Map<string, T>, by: (v: T) => number, n = 8) =>
      [...m.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => by(b as T) - by(a as T)).slice(0, n);

    return {
      sales: {
        totalHt: round2(salesHt),
        totalTtc: round2(salesTtc),
        count: saleCount,
        averageBasket: saleCount ? round2(salesTtc / saleCount) : 0,
        estimatedMargin: round2(margin),
        marginRate: productHt > 0 ? round2((margin / productHt) * 100) : 0,
        credit: { count: creditCount, amount: round2(creditAmount) },
        topProducts: topN(byProduct, (v) => v.revenue).map((p) => ({ ...p, quantity: round2(p.quantity), revenue: round2(p.revenue) })),
        topCustomers: topN(byCustomer, (v) => v.revenue).map((c) => ({ ...c, revenue: round2(c.revenue) })),
      },
      purchases: {
        total: round2(purchases),
        count: purchaseCount,
        topSuppliers: topN(bySupplier, (v) => v.amount).map((s) => ({ ...s, amount: round2(s.amount) })),
      },
      payments: {
        collected,
        credit: round2(creditAmount),
        byMethod: [...collectedBy.entries()]
          .map(([method, amount]) => ({ method, label: METHOD_LABEL[method], amount: round2(amount) }))
          .sort((a, b) => b.amount - a.amount),
      },
      series: [...series.values()],
    };
  }

  private async balances(orgId: string) {
    const [balances, partners] = await Promise.all([
      this.ledger.balances(orgId),
      this.prisma.partner.findMany({ where: { orgId, deletedAt: null }, select: { id: true, name: true, code: true, isCustomer: true, isSupplier: true } }),
    ]);
    const named = new Map(partners.map((p) => [p.id, p]));
    const debtors = [...balances.entries()]
      .filter(([id, b]) => named.get(id)?.isCustomer && b.customerBalance > 0.004)
      .map(([id, b]) => ({ id, name: named.get(id)!.name, code: named.get(id)!.code, balance: b.customerBalance }))
      .sort((a, b) => b.balance - a.balance);
    const creditors = [...balances.entries()]
      .filter(([id, b]) => named.get(id)?.isSupplier && b.supplierBalance > 0.004)
      .map(([id, b]) => ({ id, name: named.get(id)!.name, code: named.get(id)!.code, balance: b.supplierBalance }))
      .sort((a, b) => b.balance - a.balance);
    return {
      customers: { total: round2(debtors.reduce((s, d) => s + d.balance, 0)), count: debtors.length, top: debtors.slice(0, 5) },
      suppliers: { total: round2(creditors.reduce((s, d) => s + d.balance, 0)), count: creditors.length, top: creditors.slice(0, 5) },
    };
  }

  private async stock(orgId: string, siteId?: string) {
    const levels = await this.prisma.stockLevel.findMany({
      where: { product: { orgId, deletedAt: null, variantSizes: { isEmpty: true }, variantColors: { isEmpty: true } }, ...(siteId ? { siteId } : {}) },
      include: { product: { select: { id: true, sku: true, name: true, minThreshold: true, averageCost: true } }, site: { select: { name: true } } },
    });
    const outOfStock = levels
      .filter((l) => Number(l.quantityOnHand) <= 0)
      .map((l) => ({ productId: l.product.id, sku: l.product.sku, name: l.product.name, site: l.site.name, quantity: Number(l.quantityOnHand) }));
    const low = levels.filter((l) => {
      const q = Number(l.quantityOnHand);
      return q > 0 && l.product.minThreshold != null && q <= Number(l.product.minThreshold);
    });
    const value = round2(levels.reduce((s, l) => s + Math.max(0, Number(l.quantityOnHand)) * Number(l.product.averageCost), 0));
    const now = new Date();
    const soon = new Date(now.getTime() + 30 * 86_400_000);
    const batches = await this.prisma.batch.findMany({
      where: { orgId, expiryDate: { not: null, lte: soon }, status: { not: 'depleted' } },
      include: { product: { select: { sku: true, name: true } } },
      orderBy: { expiryDate: 'asc' },
    });
    const lot = (b: (typeof batches)[number]) => ({ lotNumber: b.lotNumber, sku: b.product.sku, name: b.product.name, expiryDate: b.expiryDate, status: b.status });
    return {
      value,
      outOfStock: outOfStock.slice(0, 20),
      outOfStockCount: outOfStock.length,
      lowStockCount: low.length,
      lowStock: low.slice(0, 20).map((l) => ({ productId: l.product.id, name: l.product.name, site: l.site.name, quantity: Number(l.quantityOnHand) })),
      expired: batches.filter((b) => (b.expiryDate as Date) < now).map(lot),
      expiringSoon: batches.filter((b) => (b.expiryDate as Date) >= now).map(lot),
    };
  }
}
