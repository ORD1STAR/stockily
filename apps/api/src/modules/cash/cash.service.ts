import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerService } from '../invoicing/ledger.service';
import { TradeService } from '../trade/trade.service';
import { CreateCashEntryDto } from './cash.dto';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const METHOD_LABEL: Record<string, string> = { especes: 'Espèces', carte: 'Carte', cheque: 'Chèque', virement: 'Virement', autre: 'Autre', inconnu: 'Non précisé' };
// Older payments were recorded with free-text / English method codes.
const METHOD_ALIAS: Record<string, string> = { cash: 'especes', espece: 'especes', card: 'carte', cb: 'carte', check: 'cheque', transfer: 'virement', bank_transfer: 'virement', wire: 'virement' };
const normMethod = (m: string | null | undefined) => {
  const k = (m ?? '').trim().toLowerCase();
  if (!k) return 'inconnu'; // older payments recorded without a method
  return METHOD_LABEL[k] ? k : (METHOD_ALIAS[k] ?? 'autre');
};

/** Where a journal line comes from — only `manual` and `payment` can be cancelled from the caisse. */
export type CashSource = 'manual' | 'payment' | 'invoice_payment' | 'counter_sale' | 'counter_movement';

export interface CashJournalEntry {
  id: string;
  source: CashSource;
  date: Date;
  direction: 'in' | 'out';
  amount: number;
  method: string;
  methodLabel: string;
  /** What happened, e.g. "Versement sur BL", "Vente comptoir", "Encaissement libre". */
  label: string;
  description: string | null;
  partner: { id: string; name: string } | null;
  product: { id: string; name: string } | null;
  /** The bon / facture the money belongs to. */
  document: { type: string; id: string; number: string } | null;
  site: { id: string; name: string } | null;
  cancellable: boolean;
}

/**
 * La caisse: every movement of money, read from the records that already
 * hold it — versements on bons (PartnerPayment), règlements de factures
 * (Payment), ventes encaissées au comptoir, mouvements de tiroir des
 * comptoirs — plus the free entries recorded here (CashEntry). Nothing is
 * copied, so the journal can never disagree with the bons and factures.
 */
@Injectable()
export class CashService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trade: TradeService,
  ) {}

  private async collect(orgId: string, to: Date): Promise<CashJournalEntry[]> {
    const [payments, invoicePayments, counterSales, counterMoves, manual, sites] = await Promise.all([
      this.prisma.partnerPayment.findMany({ where: { orgId, cancelledAt: null, paidAt: { lte: to } }, include: { partner: { select: { id: true, name: true } } } }),
      this.prisma.payment.findMany({
        where: { paidAt: { lte: to }, invoice: { orgId, deletedAt: null, kind: 'invoice', status: { in: ['unpaid', 'partially_paid', 'paid'] } } },
        include: { invoice: { select: { id: true, number: true, type: true, siteId: true, paymentMode: true, partner: { select: { id: true, name: true } } } } },
      }),
      this.prisma.tradeDocument.findMany({
        where: { orgId, status: 'validated', counterSessionId: { not: null }, amountPaidAtCounter: { gt: 0 }, issuedAt: { lte: to } },
        select: { id: true, number: true, siteId: true, issuedAt: true, paymentMethod: true, amountPaidAtCounter: true, partner: { select: { id: true, name: true } }, counterSession: { select: { counter: { select: { name: true } } } } },
      }),
      this.prisma.counterCashMovement.findMany({
        where: { createdAt: { lte: to }, session: { orgId } },
        include: { session: { select: { number: true, counter: { select: { name: true, siteId: true } } } } },
      }),
      this.prisma.cashEntry.findMany({ where: { orgId, cancelledAt: null, occurredAt: { lte: to } } }),
      this.prisma.site.findMany({ where: { orgId }, select: { id: true, name: true } }),
    ]);
    const siteName = new Map(sites.map((s) => [s.id, s.name]));
    const site = (id: string | null | undefined) => (id ? { id, name: siteName.get(id) ?? '—' } : null);

    // The bons the versements are attached to (number, dépôt, comptoir).
    const docIds = payments.filter((p) => p.documentId && p.documentType !== 'purchase_receipt').map((p) => p.documentId as string);
    const receiptIds = payments.filter((p) => p.documentId && p.documentType === 'purchase_receipt').map((p) => p.documentId as string);
    const [docs, receipts] = await Promise.all([
      this.prisma.tradeDocument.findMany({ where: { orgId, id: { in: docIds } }, select: { id: true, number: true, type: true, siteId: true, counterSessionId: true, amountPaidAtCounter: true } }),
      this.prisma.purchaseReceipt.findMany({ where: { orgId, id: { in: receiptIds } }, select: { id: true, number: true, siteId: true } }),
    ]);
    const docById = new Map(docs.map((d) => [d.id, d]));
    const receiptById = new Map(receipts.map((r) => [r.id, r]));

    // Free entries: resolve the referenced partner / product names.
    const [refPartners, refProducts] = await Promise.all([
      this.prisma.partner.findMany({ where: { orgId, id: { in: manual.map((m) => m.partnerId).filter((v): v is string => !!v) } }, select: { id: true, name: true } }),
      this.prisma.product.findMany({ where: { orgId, id: { in: manual.map((m) => m.productId).filter((v): v is string => !!v) } }, select: { id: true, name: true } }),
    ]);
    const partnerById = new Map(refPartners.map((p) => [p.id, p]));
    const productById = new Map(refProducts.map((p) => [p.id, p]));

    const out: CashJournalEntry[] = [];
    const push = (e: Omit<CashJournalEntry, 'methodLabel' | 'amount' | 'method'> & { amount: unknown; method: string | null }) => {
      const method = normMethod(e.method);
      out.push({ ...e, amount: round2(Number(e.amount)), method, methodLabel: METHOD_LABEL[method] });
    };

    for (const p of payments) {
      const doc = p.documentId ? docById.get(p.documentId) : undefined;
      // A comptoir sale paid at the till is already counted from the sale itself.
      if (doc?.counterSessionId && Number(doc.amountPaidAtCounter) > 0) continue;
      const receipt = p.documentId ? receiptById.get(p.documentId) : undefined;
      const dir = p.direction === 'out' ? 'out' : 'in';
      let label: string;
      if (doc?.type === 'delivery_note') label = dir === 'in' ? 'Versement sur BL' : 'Remboursement sur BL';
      else if (doc?.type === 'customer_return') label = 'Remboursement retour client';
      else if (doc?.type === 'supplier_return') label = 'Remboursement retour fournisseur';
      else if (receipt) label = dir === 'out' ? 'Paiement bon de réception' : 'Remboursement sur réception';
      else label = dir === 'in' ? 'Versement client' : 'Paiement fournisseur';
      push({
        id: p.id,
        source: 'payment',
        date: p.paidAt,
        direction: dir,
        amount: p.amount,
        method: p.method,
        label,
        description: p.notes,
        partner: p.partner,
        product: null,
        document: doc ? { type: doc.type, id: doc.id, number: doc.number } : receipt ? { type: 'purchase_receipt', id: receipt.id, number: receipt.number ?? 'BR' } : null,
        site: site(doc?.siteId ?? receipt?.siteId),
        cancellable: true,
      });
    }
    for (const p of invoicePayments) {
      const inv = p.invoice;
      const customer = inv.type === 'CUSTOMER';
      push({
        id: p.id,
        source: 'invoice_payment',
        date: p.paidAt,
        direction: customer ? 'in' : 'out',
        amount: p.amount,
        method: p.method || (inv.paymentMode && inv.paymentMode !== 'terme' ? inv.paymentMode : null),
        label: customer ? 'Règlement facture' : 'Règlement facture fournisseur',
        description: null,
        partner: inv.partner,
        product: null,
        document: { type: customer ? 'invoice' : 'supplier_invoice', id: inv.id, number: inv.number ?? 'Facture' },
        site: site(inv.siteId),
        cancellable: false,
      });
    }
    for (const d of counterSales) {
      push({
        id: d.id,
        source: 'counter_sale',
        date: d.issuedAt,
        direction: 'in',
        amount: d.amountPaidAtCounter,
        method: d.paymentMethod,
        label: 'Vente comptoir',
        description: d.counterSession?.counter.name ?? null,
        partner: d.partner,
        product: null,
        document: { type: 'delivery_note', id: d.id, number: d.number },
        site: site(d.siteId),
        cancellable: false,
      });
    }
    for (const m of counterMoves) {
      push({
        id: m.id,
        source: 'counter_movement',
        date: m.createdAt,
        direction: m.direction === 'out' ? 'out' : 'in',
        amount: m.amount,
        method: 'especes',
        label: m.direction === 'out' ? 'Sortie de caisse comptoir' : 'Entrée de caisse comptoir',
        description: `${m.reason} — ${m.session.counter.name}`,
        partner: null,
        product: null,
        document: null,
        site: site(m.session.counter.siteId),
        cancellable: false,
      });
    }
    for (const m of manual) {
      push({
        id: m.id,
        source: 'manual',
        date: m.occurredAt,
        direction: m.direction === 'out' ? 'out' : 'in',
        amount: m.amount,
        method: m.method,
        label: m.direction === 'out' ? 'Décaissement libre' : 'Encaissement libre',
        description: m.description,
        partner: m.partnerId ? (partnerById.get(m.partnerId) ?? null) : null,
        product: m.productId ? (productById.get(m.productId) ?? null) : null,
        document: null,
        site: site(m.siteId),
        cancellable: true,
      });
    }
    return out;
  }

  async journal(orgId: string, fromStr: string, toStr: string, siteId?: string) {
    const from = new Date(fromStr);
    from.setHours(0, 0, 0, 0);
    const to = new Date(toStr);
    to.setHours(23, 59, 59, 999);
    const all = (await this.collect(orgId, to)).filter((e) => !siteId || e.site?.id === siteId);
    const signed = (e: CashJournalEntry) => (e.direction === 'in' ? e.amount : -e.amount);

    const before = all.filter((e) => e.date < from);
    const entries = all.filter((e) => e.date >= from).sort((a, b) => b.date.getTime() - a.date.getTime());
    const openingBalance = round2(before.reduce((s, e) => s + signed(e), 0));
    const totalIn = round2(entries.filter((e) => e.direction === 'in').reduce((s, e) => s + e.amount, 0));
    const totalOut = round2(entries.filter((e) => e.direction === 'out').reduce((s, e) => s + e.amount, 0));

    // Per payment method: the all-time balance (what should be in the drawer
    // for espèces) and the period's flows.
    const byMethod = new Map<string, { method: string; label: string; in: number; out: number; balance: number }>();
    for (const e of all) {
      const m = byMethod.get(e.method) ?? { method: e.method, label: e.methodLabel, in: 0, out: 0, balance: 0 };
      m.balance = round2(m.balance + signed(e));
      if (e.date >= from) {
        if (e.direction === 'in') m.in = round2(m.in + e.amount);
        else m.out = round2(m.out + e.amount);
      }
      byMethod.set(e.method, m);
    }
    const order = Object.keys(METHOD_LABEL);
    return {
      period: { from: from.toISOString(), to: to.toISOString() },
      openingBalance,
      totalIn,
      totalOut,
      net: round2(totalIn - totalOut),
      closingBalance: round2(openingBalance + totalIn - totalOut),
      byMethod: [...byMethod.values()].sort((a, b) => order.indexOf(a.method) - order.indexOf(b.method)),
      entries,
    };
  }

  /** The partner's bons still to be paid: BL (encaissement) or bons de réception (décaissement). */
  async openDocuments(orgId: string, partnerId: string, direction: 'in' | 'out') {
    const payments = await this.prisma.partnerPayment.findMany({ where: { orgId, partnerId, cancelledAt: null, documentId: { not: null } } });
    const paidOn = (id: string) => payments.filter((p) => p.documentId === id).reduce((s, p) => s + (p.direction === direction ? 1 : -1) * Number(p.amount), 0);
    const rows: { type: 'delivery_note' | 'purchase_receipt'; id: string; number: string; date: Date; total: number; paid: number; remaining: number }[] = [];
    if (direction === 'in') {
      const docs = await this.prisma.tradeDocument.findMany({
        where: { orgId, partnerId, type: 'delivery_note', status: 'validated' },
        include: { lines: { include: { taxRate: true } } },
        orderBy: { issuedAt: 'desc' },
      });
      for (const d of docs) {
        if (d.counterSessionId && Number(d.amountPaidAtCounter) > 0) continue;
        const total = LedgerService.documentTotal(d.lines).totalTtc;
        const paid = round2(paidOn(d.id));
        rows.push({ type: 'delivery_note', id: d.id, number: d.number, date: d.issuedAt, total, paid, remaining: round2(total - paid) });
      }
    } else {
      const receipts = await this.prisma.purchaseReceipt.findMany({ where: { orgId, supplierId: partnerId, cancelledAt: null }, include: { lines: true }, orderBy: { receivedAt: 'desc' } });
      for (const r of receipts) {
        const total = LedgerService.receiptTotal(r.lines);
        const paid = round2(paidOn(r.id));
        rows.push({ type: 'purchase_receipt', id: r.id, number: r.number ?? 'BR', date: r.receivedAt, total, paid, remaining: round2(total - paid) });
      }
    }
    return rows.filter((r) => r.remaining > 0.004);
  }

  async create(orgId: string, userId: string, dto: CreateCashEntryDto) {
    const method = dto.method ?? 'especes';
    const description = dto.description?.trim() || null;
    const partner = dto.partnerId ? await this.prisma.partner.findFirst({ where: { id: dto.partnerId, orgId, deletedAt: null } }) : null;
    if (dto.partnerId && !partner) throw new NotFoundException('Client / fournisseur introuvable.');
    const product = dto.productId ? await this.prisma.product.findFirst({ where: { id: dto.productId, orgId }, select: { id: true, name: true } }) : null;
    if (dto.productId && !product) throw new NotFoundException('Produit introuvable.');
    if (dto.siteId && !(await this.prisma.site.findFirst({ where: { id: dto.siteId, orgId } }))) throw new NotFoundException('Dépôt introuvable.');

    // A bon, or a versement on the partner's account: it is a payment of
    // that partner, so it updates the bon's reste and the partner's solde.
    if (dto.documentId || (partner && dto.applyToBalance)) {
      if (!partner) throw new BadRequestException('Choisissez le client / fournisseur du bon.');
      if (dto.documentId) {
        const expected = dto.direction === 'in' ? 'delivery_note' : 'purchase_receipt';
        if (dto.documentType && dto.documentType !== expected)
          throw new BadRequestException(dto.direction === 'in' ? 'Un encaissement se rattache à un bon de livraison.' : 'Un décaissement se rattache à un bon de réception.');
      } else if ((dto.direction === 'in' && !partner.isCustomer) || (dto.direction === 'out' && !partner.isSupplier)) {
        throw new BadRequestException(dto.direction === 'in' ? 'Seul un client peut verser sur son compte.' : 'Seul un fournisseur peut être payé sur son compte.');
      }
      const notes = [description, product ? `Produit : ${product.name}` : null].filter(Boolean).join(' — ') || undefined;
      const payment = await this.trade.createPayment(orgId, userId, {
        partnerId: partner.id,
        direction: dto.direction,
        amount: dto.amount,
        method,
        notes,
        paidAt: dto.occurredAt,
        documentId: dto.documentId,
        documentType: dto.documentId ? (dto.direction === 'in' ? 'delivery_note' : 'purchase_receipt') : undefined,
      });
      return { source: 'payment' as const, id: payment.id };
    }

    const entry = await this.prisma.cashEntry.create({
      data: {
        orgId,
        siteId: dto.siteId || null,
        direction: dto.direction,
        amount: dto.amount,
        method,
        occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
        description,
        partnerId: partner?.id ?? null,
        productId: product?.id ?? null,
        createdBy: userId,
      },
    });
    return { source: 'manual' as const, id: entry.id };
  }

  async cancel(orgId: string, source: 'manual' | 'payment', id: string) {
    if (source === 'payment') return this.trade.cancelPayment(orgId, id);
    const entry = await this.prisma.cashEntry.findFirst({ where: { id, orgId, cancelledAt: null } });
    if (!entry) throw new NotFoundException('Mouvement introuvable.');
    await this.prisma.cashEntry.update({ where: { id }, data: { cancelledAt: new Date() } });
  }
}
