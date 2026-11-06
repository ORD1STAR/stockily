import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerService, LedgerSide } from '../invoicing/ledger.service';
import { DocumentPdfService, PdfParty, formatMoney } from '../shared-pdf/document-pdf.service';
import { TradeDocumentType } from './dto/trade.dto';

const TITLE: Record<TradeDocumentType, string> = {
  delivery_note: 'BON DE LIVRAISON',
  customer_return: 'BON DE RETOUR CLIENT',
  supplier_return: 'BON DE RETOUR FOURNISSEUR',
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface UnpaidRow {
  date: Date;
  ref: string;
  code: string;
  designation: string;
  total: number;
  paid: number;
  remaining: number;
}

interface OpenItem {
  date: Date;
  ref: string;
  lines: { code: string; designation: string; total: number }[];
  total: number;
  /** Paid directly on this document (versement on the bon, payment on the invoice). */
  paidDirect: number;
}

function partyOf(p: { name: string; code: string | null; address: string | null; nif: string | null; rc: string | null; taxArticle: string | null; phone: string | null }): PdfParty {
  return { name: p.name, code: p.code, address: p.address, nif: p.nif, rc: p.rc, taxArticle: p.taxArticle, phone: p.phone };
}

/**
 * Printed documents of the trade module: bons de livraison / retours, and
 * the état des créances (client) / état des dettes (fournisseur) — every
 * line still not paid, with what was paid on it and what remains.
 */
@Injectable()
export class TradePrintService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: DocumentPdfService,
    private readonly ledger: LedgerService,
  ) {}

  private orgBlock(org: { name: string; address: string | null; nif: string | null; nis: string | null; rc: string | null; taxArticle: string | null; phone: string | null; logo: string | null }) {
    return { name: org.name, address: org.address, nif: org.nif, nis: org.nis, rc: org.rc, taxArticle: org.taxArticle, phone: org.phone, logo: org.logo };
  }

  async documentPdf(orgId: string, id: string, types: TradeDocumentType[]): Promise<Buffer> {
    const doc = await this.prisma.tradeDocument.findFirst({
      where: { id, orgId, type: { in: types } },
      include: {
        organization: true,
        site: true,
        partner: true,
        salesOrder: { select: { number: true } },
        invoice: { select: { number: true, status: true } },
        lines: { include: { taxRate: true, product: { select: { sku: true, unitsPerCarton: true } } } },
      },
    });
    if (!doc) throw new NotFoundException(`Document inconnu : ${id}`);
    const type = doc.type as TradeDocumentType;
    const totals = LedgerService.documentTotal(doc.lines);
    const side: LedgerSide = type === 'supplier_return' ? 'supplier' : 'customer';
    const account =
      doc.partnerId && doc.status === 'validated'
        ? await this.ledger.balanceAroundDocument(orgId, doc.partnerId, doc.id, side, doc.invoice?.status !== 'void' ? doc.invoiceId : null)
        : null;

    const refs = [doc.salesOrder?.number ? `Commande : ${doc.salesOrder.number}` : null, doc.invoice?.number && doc.invoice.status !== 'void' ? `Facture : ${doc.invoice.number}` : null].filter(Boolean);

    return this.pdf.generate({
      title: TITLE[type],
      number: doc.number,
      date: doc.issuedAt,
      statusLabel: doc.status === 'cancelled' ? 'Annulé' : null,
      referenceLine: refs.length ? refs.join(' · ') : null,
      org: this.orgBlock(doc.organization),
      counterpartyLabel: side === 'supplier' ? 'FOURNISSEUR' : 'CLIENT',
      counterparty: doc.partner ? partyOf(doc.partner) : null,
      counterpartyFallback: 'Client comptoir',
      meta: [{ label: 'Dépôt', value: doc.site.name }],
      columns: [
        { key: 'n', label: 'N°', width: 22 },
        { key: 'ref', label: 'Réf.', width: 76 },
        { key: 'designation', label: 'Désignation', width: 121 },
        { key: 'qty', label: 'Qté', width: 34, align: 'right' as const },
        { key: 'cartons', label: 'Cartons', width: 52, align: 'right' as const },
        { key: 'unit', label: 'P.U.', width: 62, align: 'right' as const },
        { key: 'disc', label: 'Remise', width: 44, align: 'right' as const },
        { key: 'total', label: 'Total TTC', width: 80, align: 'right' as const },
      ],
      lines: doc.lines.map((l, i) => {
        const qty = Number(l.quantity);
        const perCarton = l.product?.unitsPerCarton ?? null;
        const disc = l.discountPercent != null ? Number(l.discountPercent) : 0;
        return {
          cells: {
            n: String(i + 1),
            ref: l.product?.sku ?? '',
            designation: l.description,
            qty: String(qty),
            cartons: perCarton ? String(round2(qty / perCarton)) : '',
            unit: formatMoney(Number(l.unitPrice)),
            disc: disc ? `${disc} %` : '',
            total: formatMoney(totals.lines[i].totalAmount),
          },
        };
      }),
      summary: [
        ...(totals.totalTax > 0
          ? [
              { label: 'Total HT', value: `${formatMoney(totals.totalHt)} DZD` },
              { label: 'TVA', value: `${formatMoney(totals.totalTax)} DZD` },
            ]
          : []),
        { label: 'Total TTC', value: `${formatMoney(totals.totalTtc)} DZD`, accent: true },
        ...(account
          ? [
              { label: 'Ancien solde', value: `${formatMoney(account.previousBalance)} DZD`, separated: true },
              { label: type === 'customer_return' ? 'Remboursement' : 'Versement', value: `${formatMoney(Math.abs(account.paidWithDocument))} DZD` },
              { label: 'Nouveau solde', value: `${formatMoney(account.newBalance)} DZD`, bold: true },
            ]
          : []),
      ],
      notes: doc.notes,
      footerNote: 'Document généré par Stockily.',
    });
  }

  // ───────────────────────── État des créances / dettes ─────────────────────────

  /**
   * Everything a partner still owes us (customer side) or we still owe
   * them (supplier side), line by line. Payments made on a document pay
   * that document first; everything else (standalone versements, retours,
   * payments on invoices generated from bons) pays the oldest documents
   * first; within a document, lines are paid in order.
   */
  async unpaid(orgId: string, partnerId: string, side: LedgerSide) {
    const partner = await this.prisma.partner.findFirst({ where: { id: partnerId, orgId } });
    if (!partner) throw new NotFoundException(`Partenaire inconnu : ${partnerId}`);
    const items: OpenItem[] = [];
    let pool = 0; // credit not tied to a document

    const opening = Number(partner.openingBalance);
    const openingSide: LedgerSide = partner.isCustomer ? 'customer' : 'supplier';
    if (opening !== 0 && openingSide === side) {
      if (opening > 0) items.push({ date: new Date(0), ref: 'Solde initial', lines: [{ code: '', designation: 'Solde initial', total: opening }], total: opening, paidDirect: 0 });
      else pool += -opening;
    }

    const payments = await this.prisma.partnerPayment.findMany({ where: { orgId, partnerId, cancelledAt: null } });
    const paidOn = (documentId: string, direction: 'in' | 'out') =>
      payments.filter((p) => p.documentId === documentId).reduce((s, p) => s + (p.direction === direction ? 1 : -1) * Number(p.amount), 0);

    const docTypes = side === 'customer' ? ['delivery_note', 'customer_return'] : ['supplier_return'];
    const docs = await this.prisma.tradeDocument.findMany({
      where: { orgId, partnerId, status: 'validated', type: { in: docTypes } },
      include: { lines: { include: { taxRate: true, product: { select: { sku: true } } } } },
    });
    for (const d of docs) {
      const totals = LedgerService.documentTotal(d.lines);
      if (d.type === 'delivery_note') {
        items.push({
          date: d.issuedAt,
          ref: d.number,
          lines: d.lines.map((l, i) => ({ code: l.product?.sku ?? '', designation: l.description, total: totals.lines[i].totalAmount })),
          total: totals.totalTtc,
          paidDirect: paidOn(d.id, 'in'),
        });
      } else {
        // A retour is a credit; a refund paid with it cancels that credit.
        const refunded = paidOn(d.id, side === 'customer' ? 'out' : 'in');
        pool += totals.totalTtc - refunded;
      }
    }

    if (side === 'supplier') {
      const receipts = await this.prisma.purchaseReceipt.findMany({
        where: { orgId, supplierId: partnerId, cancelledAt: null },
        include: { lines: { include: { product: { select: { sku: true, name: true } } } } },
      });
      for (const r of receipts) {
        const lines = r.lines.map((l) => ({
          code: l.product?.sku ?? '',
          designation: l.product?.name ?? l.productId,
          total: round2(Number(l.quantityReceived) * Number(l.unitCost) * (1 - (l.discountPercent != null ? Number(l.discountPercent) : 0) / 100)),
        }));
        items.push({ date: r.receivedAt, ref: r.number ?? 'BR', lines, total: round2(lines.reduce((s, l) => s + l.total, 0)), paidDirect: paidOn(r.id, 'out') });
      }
    }

    const invoices = await this.prisma.invoice.findMany({
      where: { orgId, partnerId, deletedAt: null, kind: 'invoice', type: side === 'customer' ? 'CUSTOMER' : 'SUPPLIER', status: { in: ['unpaid', 'partially_paid', 'paid'] } },
      include: { lines: { include: { taxRate: true, product: { select: { sku: true } } } }, payments: true },
    });
    for (const inv of invoices) {
      const invPaid = inv.payments.reduce((s, p) => s + Number(p.amount), 0);
      if (inv.fromDocuments) {
        pool += invPaid; // the bons themselves are the open items
        continue;
      }
      const totals = LedgerService.documentTotal(inv.lines);
      items.push({
        date: inv.finalizedAt ?? inv.issuedAt,
        ref: inv.number ?? 'Facture',
        lines: inv.lines.map((l, i) => ({ code: l.product?.sku ?? '', designation: l.description, total: totals.lines[i].totalAmount })),
        total: round2(totals.totalTtc + Number(inv.stampDuty)),
        paidDirect: invPaid,
      });
    }

    // Standalone versements (not tied to a document).
    const standaloneIn = side === 'customer' ? 'in' : 'out';
    for (const p of payments.filter((x) => !x.documentId)) pool += (p.direction === standaloneIn ? 1 : -1) * Number(p.amount);

    // Allocate.
    items.sort((a, b) => a.date.getTime() - b.date.getTime());
    const allocated = items.map((it) => {
      const paid = Math.max(0, Math.min(it.total, it.paidDirect));
      if (it.paidDirect > it.total) pool += it.paidDirect - it.total;
      return { it, paid };
    });
    for (const a of allocated) {
      if (pool <= 0) break;
      const take = Math.min(pool, a.it.total - a.paid);
      a.paid += take;
      pool -= take;
    }

    const rows: UnpaidRow[] = [];
    for (const { it, paid } of allocated) {
      let left = paid;
      for (const l of it.lines) {
        const linePaid = Math.min(left, l.total);
        left -= linePaid;
        const remaining = round2(l.total - linePaid);
        if (remaining > 0.004) {
          rows.push({ date: it.date, ref: it.ref, code: l.code, designation: l.designation, total: round2(l.total), paid: round2(linePaid), remaining });
        }
      }
    }
    return {
      partner,
      side,
      rows,
      totals: {
        total: round2(rows.reduce((s, r) => s + r.total, 0)),
        paid: round2(rows.reduce((s, r) => s + r.paid, 0)),
        remaining: round2(rows.reduce((s, r) => s + r.remaining, 0)),
      },
      unallocatedCredit: round2(Math.max(0, pool)),
    };
  }

  async unpaidPdf(orgId: string, partnerId: string, side: LedgerSide): Promise<Buffer> {
    const data = await this.unpaid(orgId, partnerId, side);
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    const fmtDate = (d: Date) => (d.getTime() === 0 ? '—' : d.toLocaleDateString('fr-FR'));
    return this.pdf.generate({
      title: side === 'customer' ? 'ÉTAT DES CRÉANCES' : 'ÉTAT DES DETTES',
      number: data.partner.code ?? data.partner.name,
      date: new Date(),
      referenceLine: side === 'customer' ? 'Montants restant dus par le client' : 'Montants restant dus au fournisseur',
      org: this.orgBlock(org),
      counterpartyLabel: side === 'customer' ? 'CLIENT' : 'FOURNISSEUR',
      counterparty: partyOf(data.partner),
      columns: [
        { key: 'date', label: 'Date', width: 58 },
        { key: 'ref', label: 'N° doc.', width: 82 },
        { key: 'code', label: 'Code', width: 80 },
        { key: 'designation', label: 'Désignation', width: 105 },
        { key: 'total', label: 'Total', width: 57, align: 'right' as const },
        { key: 'paid', label: 'Payé', width: 55, align: 'right' as const },
        { key: 'remaining', label: 'Reste', width: 58, align: 'right' as const },
      ],
      lines:
        data.rows.length > 0
          ? data.rows.map((r) => ({
              cells: {
                date: fmtDate(r.date),
                ref: r.ref,
                code: r.code,
                designation: r.designation,
                total: formatMoney(r.total),
                paid: r.paid ? formatMoney(r.paid) : '',
                remaining: formatMoney(r.remaining),
              },
            }))
          : [{ cells: { date: '', ref: '', code: '', designation: 'Aucun impayé.', total: '', paid: '', remaining: '' } }],
      summary: [
        { label: 'Total', value: `${formatMoney(data.totals.total)} DZD` },
        { label: 'Déjà payé', value: `${formatMoney(data.totals.paid)} DZD` },
        { label: 'Reste à payer', value: `${formatMoney(data.totals.remaining)} DZD`, accent: true },
        ...(data.unallocatedCredit > 0 ? [{ label: 'Avance non affectée', value: `${formatMoney(data.unallocatedCredit)} DZD`, separated: true }] : []),
      ],
      footerNote: `État arrêté au ${new Date().toLocaleDateString('fr-FR')}, généré par Stockily.`,
    });
  }
}
