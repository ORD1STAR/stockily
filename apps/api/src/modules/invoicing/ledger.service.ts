import { Injectable } from '@nestjs/common';
import { computeInvoiceTotals } from '@org/domain-invoicing';
import { PrismaService } from '../../prisma/prisma.service';

/** customer = what a client owes us; supplier = what we owe a fournisseur. */
export type LedgerSide = 'customer' | 'supplier';

export interface LedgerEntry {
  partnerId: string;
  side: LedgerSide;
  date: Date;
  kind:
    | 'opening'
    | 'delivery_note'
    | 'customer_return'
    | 'purchase_receipt'
    | 'supplier_return'
    | 'invoice'
    | 'invoice_payment'
    | 'payment';
  /** Document number / reference shown in the statement. */
  ref: string | null;
  label: string;
  /** The document this entry belongs to (bon, invoice) — payments made with a bon carry the bon's id. */
  documentId: string | null;
  /** Signed: positive increases what is owed on this side, negative decreases it. */
  amount: number;
}

export interface PartnerBalance {
  customerBalance: number;
  supplierBalance: number;
  /** What the partner owes us net (customer − supplier) for a mixed partner, else the single side's balance. */
  balance: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const DOC_SIDE: Record<string, LedgerSide> = {
  delivery_note: 'customer',
  customer_return: 'customer',
  purchase_receipt: 'supplier',
  supplier_return: 'supplier',
};

/**
 * Partner accounts, computed from the documents themselves (no stored
 * running total that could drift): solde initial + bons de livraison −
 * retours client + factures not generated from bons − every payment, and
 * the mirror on the supplier side with bons de réception / retours
 * fournisseur. A proforma, a draft or a void invoice never counts.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /** Totals of a bon's lines (HT price, optional discount and TVA). */
  static documentTotal(lines: { id: string; quantity: unknown; unitPrice: unknown; discountPercent?: unknown; taxRate?: { rate: unknown } | null }[]) {
    return computeInvoiceTotals(
      lines.map((l) => ({
        id: l.id,
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
        discountPercent: l.discountPercent != null ? Number(l.discountPercent) : null,
        taxRatePercent: l.taxRate ? Number(l.taxRate.rate) : null,
      })),
    );
  }

  /** Total of a bon de réception (quantity × unit cost, minus line discount). */
  static receiptTotal(lines: { quantityReceived: unknown; unitCost: unknown; discountPercent?: unknown }[]) {
    return round2(
      lines.reduce((sum, l) => {
        const gross = Number(l.quantityReceived) * Number(l.unitCost);
        const disc = l.discountPercent != null ? Number(l.discountPercent) : 0;
        return sum + gross * (1 - disc / 100);
      }, 0),
    );
  }

  async entries(orgId: string, partnerId?: string): Promise<LedgerEntry[]> {
    const partnerWhere = partnerId ? { partnerId } : { partnerId: { not: null } };
    const [partners, docs, receipts, invoices, payments] = await Promise.all([
      this.prisma.partner.findMany({
        where: { orgId, ...(partnerId ? { id: partnerId } : {}) },
        select: { id: true, isCustomer: true, isSupplier: true, openingBalance: true },
      }),
      this.prisma.tradeDocument.findMany({
        where: { orgId, status: 'validated', ...partnerWhere },
        include: { lines: { include: { taxRate: true } } },
      }),
      this.prisma.purchaseReceipt.findMany({
        where: { orgId, cancelledAt: null, ...(partnerId ? { supplierId: partnerId } : { supplierId: { not: null } }) },
        include: { lines: true },
      }),
      this.prisma.invoice.findMany({
        where: {
          orgId,
          deletedAt: null,
          kind: 'invoice',
          status: { in: ['unpaid', 'partially_paid', 'paid'] },
          ...partnerWhere,
        },
        include: { lines: { include: { taxRate: true } }, payments: true },
      }),
      this.prisma.partnerPayment.findMany({ where: { orgId, cancelledAt: null, ...(partnerId ? { partnerId } : {}) } }),
    ]);

    const out: LedgerEntry[] = [];
    for (const p of partners) {
      const opening = Number(p.openingBalance);
      if (opening !== 0) {
        out.push({
          partnerId: p.id,
          side: p.isCustomer ? 'customer' : 'supplier',
          date: new Date(0),
          kind: 'opening',
          ref: null,
          label: 'Solde initial',
          documentId: null,
          amount: opening,
        });
      }
    }
    for (const d of docs) {
      const total = LedgerService.documentTotal(d.lines).totalTtc;
      const sign = d.type === 'delivery_note' ? 1 : -1;
      out.push({
        partnerId: d.partnerId as string,
        side: DOC_SIDE[d.type],
        date: d.issuedAt,
        kind: d.type as LedgerEntry['kind'],
        ref: d.number,
        label: d.type === 'delivery_note' ? 'Bon de livraison' : d.type === 'customer_return' ? 'Retour client' : 'Retour fournisseur',
        documentId: d.id,
        amount: sign * total,
      });
    }
    for (const r of receipts) {
      out.push({
        partnerId: r.supplierId as string,
        side: 'supplier',
        date: r.receivedAt,
        kind: 'purchase_receipt',
        ref: r.number,
        label: 'Bon de réception',
        documentId: r.id,
        amount: LedgerService.receiptTotal(r.lines),
      });
    }
    for (const inv of invoices) {
      const side: LedgerSide = inv.type === 'CUSTOMER' ? 'customer' : 'supplier';
      if (!inv.fromDocuments) {
        out.push({
          partnerId: inv.partnerId as string,
          side,
          date: inv.finalizedAt ?? inv.issuedAt,
          kind: 'invoice',
          ref: inv.number,
          label: inv.type === 'CUSTOMER' ? 'Facture' : 'Facture fournisseur',
          documentId: inv.id,
          amount: LedgerService.documentTotal(inv.lines).totalTtc + Number(inv.stampDuty),
        });
      }
      for (const pay of inv.payments) {
        out.push({
          partnerId: inv.partnerId as string,
          side,
          date: pay.paidAt,
          kind: 'invoice_payment',
          ref: inv.number,
          label: `Règlement facture${pay.method ? ` (${pay.method})` : ''}`,
          documentId: inv.id,
          amount: -Number(pay.amount),
        });
      }
    }
    for (const pay of payments) {
      const side: LedgerSide = pay.documentType ? DOC_SIDE[pay.documentType] : pay.direction === 'in' ? 'customer' : 'supplier';
      // On the customer side money coming in reduces what they owe; on the
      // supplier side money going out reduces what we owe. A refund (the
      // other direction) increases it again.
      const reduces = (side === 'customer' && pay.direction === 'in') || (side === 'supplier' && pay.direction === 'out');
      out.push({
        partnerId: pay.partnerId,
        side,
        date: pay.paidAt,
        kind: 'payment',
        ref: null,
        label: reduces ? 'Versement' : 'Remboursement',
        documentId: pay.documentId,
        amount: (reduces ? -1 : 1) * Number(pay.amount),
      });
    }
    out.sort((a, b) => a.date.getTime() - b.date.getTime());
    return out.map((e) => ({ ...e, amount: round2(e.amount) }));
  }

  async balances(orgId: string): Promise<Map<string, PartnerBalance>> {
    const [partners, entries] = await Promise.all([
      this.prisma.partner.findMany({ where: { orgId }, select: { id: true, isCustomer: true, isSupplier: true } }),
      this.entries(orgId),
    ]);
    const map = new Map<string, PartnerBalance>();
    for (const p of partners) map.set(p.id, { customerBalance: 0, supplierBalance: 0, balance: 0 });
    for (const e of entries) {
      const b = map.get(e.partnerId);
      if (!b) continue;
      if (e.side === 'customer') b.customerBalance += e.amount;
      else b.supplierBalance += e.amount;
    }
    for (const p of partners) {
      const b = map.get(p.id) as PartnerBalance;
      b.customerBalance = round2(b.customerBalance);
      b.supplierBalance = round2(b.supplierBalance);
      b.balance = p.isCustomer && p.isSupplier ? round2(b.customerBalance - b.supplierBalance) : p.isSupplier && !p.isCustomer ? b.supplierBalance : b.customerBalance;
    }
    return map;
  }

  /**
   * Ancien solde / versement / nouveau solde around one bon, on that bon's
   * side of the account: everything dated before the bon, then the bon
   * itself and the payments made with it.
   */
  async balanceAroundDocument(
    orgId: string,
    partnerId: string,
    documentId: string,
    side: LedgerSide,
    /** The facture generated from this bon: payments made on it count as paid on the bon. */
    invoiceId?: string | null,
  ) {
    const entries = (await this.entries(orgId, partnerId)).filter((e) => e.side === side);
    const docEntry = entries.find((e) => e.documentId === documentId && e.kind !== 'payment' && e.kind !== 'invoice_payment');
    const docDate = docEntry?.date.getTime() ?? Date.now();
    const before = entries.filter((e) => e.documentId !== documentId && e.date.getTime() < docDate).reduce((s, e) => s + e.amount, 0);
    const docAmount = docEntry?.amount ?? 0;
    const paidWithDoc = entries
      .filter((e) => (e.documentId === documentId && e.kind === 'payment') || (!!invoiceId && e.documentId === invoiceId && e.kind === 'invoice_payment'))
      .reduce((s, e) => s + e.amount, 0);
    return {
      previousBalance: round2(before),
      documentAmount: round2(docAmount),
      paidWithDocument: round2(-paidWithDoc),
      newBalance: round2(before + docAmount + paidWithDoc),
    };
  }
}
