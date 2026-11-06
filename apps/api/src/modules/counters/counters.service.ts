import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { setTenantOnTransaction } from '@org/infra-db';
import { PrismaService } from '../../prisma/prisma.service';
import { nextDocumentNumber } from '../invoicing/document-numbering';
import { formatMoney } from '../shared-pdf/document-pdf.service';
import { TradeService } from '../trade/trade.service';
import { SiteAccessService } from '../tenancy/services/site-access.service';
import { CashMovementDto, CloseSessionDto, CounterSaleDto, CreateCounterDto, OpenSessionDto, UpdateCounterDto } from './counters.dto';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const METHOD_LABEL: Record<string, string> = { especes: 'Espèces', carte: 'Carte', cheque: 'Chèque', credit: 'À crédit' };

/**
 * Comptoirs (caisses). A sale at a comptoir is a bon de livraison attached
 * to the open session — stock, partner balance and invoicing then work
 * exactly like any other BL. The session tracks the cash: fond de caisse +
 * cash sales + entrées − sorties = espèces attendues at closing.
 */
@Injectable()
export class CountersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trade: TradeService,
    private readonly siteAccess: SiteAccessService,
  ) {}

  // A site-scoped sub-user (e.g. a caissier at one dépôt) only sees that
  // site's comptoirs; an org-wide role ('all') sees everything.
  private siteFilter(scope: 'all' | string[]) {
    return scope === 'all' ? {} : { siteId: { in: scope.length ? scope : ['__none__'] } };
  }

  // ───────── Comptoirs ─────────

  async list(orgId: string, userId: string) {
    const scope = await this.siteAccess.getAccessibleSiteIds(userId, orgId);
    const counters = await this.prisma.counter.findMany({
      where: { orgId, ...this.siteFilter(scope) },
      include: { site: { select: { id: true, name: true } }, sessions: { where: { status: 'open' }, select: { id: true } } },
      orderBy: { name: 'asc' },
    });
    return Promise.all(
      counters.map(async (c) => ({
        id: c.id,
        name: c.name,
        isActive: c.isActive,
        site: c.site,
        openSession: c.sessions[0] ? await this.summary(orgId, c.sessions[0].id) : null,
      })),
    );
  }

  async create(orgId: string, dto: CreateCounterDto) {
    const site = await this.prisma.site.findFirst({ where: { id: dto.siteId, orgId } });
    if (!site) throw new NotFoundException(`Dépôt inconnu : ${dto.siteId}`);
    return this.prisma.counter.create({ data: { orgId, siteId: dto.siteId, name: dto.name.trim() } });
  }

  async update(orgId: string, id: string, dto: UpdateCounterDto) {
    const counter = await this.prisma.counter.findFirst({ where: { id, orgId } });
    if (!counter) throw new NotFoundException(`Comptoir inconnu : ${id}`);
    return this.prisma.counter.update({
      where: { id },
      data: { ...(dto.name !== undefined ? { name: dto.name.trim() } : {}), ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}) },
    });
  }

  // ───────── Sessions ─────────

  async open(orgId: string, userId: string, counterId: string, dto: OpenSessionDto) {
    const counter = await this.prisma.counter.findFirst({ where: { id: counterId, orgId } });
    if (!counter) throw new NotFoundException(`Comptoir inconnu : ${counterId}`);
    if (!counter.isActive) throw new BadRequestException('Ce comptoir est désactivé.');
    const already = await this.prisma.counterSession.findFirst({ where: { counterId, status: 'open' } });
    if (already) throw new BadRequestException(`La caisse est déjà ouverte (${already.number}).`);
    const session = await this.prisma.$transaction(async (tx) => {
      await setTenantOnTransaction(tx, orgId);
      const number = await nextDocumentNumber(tx, orgId, 'counter_session', 'Z');
      return tx.counterSession.create({ data: { orgId, counterId, number, openedBy: userId, openingCash: dto.openingCash } });
    });
    return this.summary(orgId, session.id);
  }

  async listSessions(orgId: string, userId: string, counterId?: string) {
    const scope = await this.siteAccess.getAccessibleSiteIds(userId, orgId);
    const sessions = await this.prisma.counterSession.findMany({
      where: { orgId, ...(counterId ? { counterId } : {}), ...(scope === 'all' ? {} : { counter: { is: this.siteFilter(scope) } }) },
      orderBy: { openedAt: 'desc' },
      take: 100,
      select: { id: true },
    });
    return Promise.all(sessions.map((s) => this.summary(orgId, s.id)));
  }

  /** Session totals: sales by payment method, cash movements, expected cash. */
  async summary(orgId: string, sessionId: string) {
    const s = await this.prisma.counterSession.findFirst({
      where: { id: sessionId, orgId },
      include: {
        counter: { include: { site: { select: { id: true, name: true } } } },
        movements: { orderBy: { createdAt: 'asc' } },
        documents: { where: { status: 'validated' }, include: { lines: { include: { taxRate: true } } } },
      },
    });
    if (!s) throw new NotFoundException(`Session inconnue : ${sessionId}`);
    const byMethod: Record<string, { count: number; total: number }> = {};
    let salesTotal = 0;
    for (const d of s.documents) {
      const ttc = computeTtc(d.lines);
      salesTotal += ttc;
      const m = d.paymentMethod ?? 'credit';
      byMethod[m] = byMethod[m] ?? { count: 0, total: 0 };
      byMethod[m].count += 1;
      byMethod[m].total = round2(byMethod[m].total + ttc);
    }
    const cashSales = s.documents.filter((d) => d.paymentMethod === 'especes').reduce((sum, d) => sum + Number(d.amountPaidAtCounter), 0);
    const cashIn = s.movements.filter((m) => m.direction === 'in').reduce((sum, m) => sum + Number(m.amount), 0);
    const cashOut = s.movements.filter((m) => m.direction === 'out').reduce((sum, m) => sum + Number(m.amount), 0);
    const expectedCash = round2(Number(s.openingCash) + cashSales + cashIn - cashOut);
    return {
      id: s.id,
      number: s.number,
      status: s.status,
      counter: { id: s.counter.id, name: s.counter.name, site: s.counter.site },
      openedAt: s.openedAt,
      closedAt: s.closedAt,
      openingCash: Number(s.openingCash),
      salesCount: s.documents.length,
      salesTotal: round2(salesTotal),
      byMethod: Object.entries(byMethod).map(([method, v]) => ({ method, label: METHOD_LABEL[method] ?? method, ...v })),
      cashSales: round2(cashSales),
      cashIn: round2(cashIn),
      cashOut: round2(cashOut),
      expectedCash: s.status === 'closed' && s.expectedCash != null ? Number(s.expectedCash) : expectedCash,
      countedCash: s.countedCash != null ? Number(s.countedCash) : null,
      difference: s.countedCash != null && s.expectedCash != null ? round2(Number(s.countedCash) - Number(s.expectedCash)) : null,
      notes: s.notes,
      movements: s.movements.map((m) => ({ id: m.id, direction: m.direction, amount: Number(m.amount), reason: m.reason, createdAt: m.createdAt })),
    };
  }

  async addMovement(orgId: string, userId: string, sessionId: string, dto: CashMovementDto) {
    const s = await this.openSession(orgId, sessionId);
    await this.prisma.counterCashMovement.create({ data: { sessionId: s.id, direction: dto.direction, amount: dto.amount, reason: dto.reason.trim(), createdBy: userId } });
    return this.summary(orgId, sessionId);
  }

  async close(orgId: string, userId: string, sessionId: string, dto: CloseSessionDto) {
    await this.openSession(orgId, sessionId);
    const sum = await this.summary(orgId, sessionId);
    await this.prisma.counterSession.update({
      where: { id: sessionId },
      data: { status: 'closed', closedAt: new Date(), closedBy: userId, countedCash: dto.countedCash, expectedCash: sum.expectedCash, notes: dto.notes ?? null },
    });
    return this.summary(orgId, sessionId);
  }

  // ───────── Vente ─────────

  async sale(orgId: string, userId: string, sessionId: string, dto: CounterSaleDto) {
    const session = await this.openSession(orgId, sessionId);
    const counter = await this.prisma.counter.findUniqueOrThrow({ where: { id: session.counterId } });
    if (!dto.paid && !dto.partnerId) throw new BadRequestException('Une vente à crédit doit avoir un client.');
    const method = dto.paid ? dto.paymentMethod ?? 'especes' : null;

    const doc = await this.trade.createDocument(orgId, userId, {
      type: 'delivery_note',
      siteId: counter.siteId,
      partnerId: dto.partnerId,
      notes: `Vente comptoir ${counter.name}`,
      lines: dto.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice, taxRateId: l.taxRateId })),
    });
    const total = doc.totals.totalTtc;
    await this.prisma.tradeDocument.update({
      where: { id: doc.id },
      data: { counterSessionId: session.id, paymentMethod: method, amountPaidAtCounter: dto.paid ? total : 0 },
    });
    if (dto.paid && dto.partnerId) {
      await this.trade.createPayment(orgId, userId, {
        partnerId: dto.partnerId,
        direction: 'in',
        amount: total,
        method: method === 'carte' ? 'autre' : method ?? 'especes',
        documentType: 'delivery_note',
        documentId: doc.id,
      });
    }
    return {
      document: { id: doc.id, number: doc.number, total },
      paymentMethod: method,
      amountReceived: dto.amountReceived ?? null,
      change: dto.paid && method === 'especes' && dto.amountReceived != null ? round2(dto.amountReceived - total) : 0,
    };
  }

  // ───────── Impression (ticket 80 mm) ─────────

  async ticketPdf(orgId: string, documentId: string): Promise<Buffer> {
    const doc = await this.prisma.tradeDocument.findFirst({
      where: { id: documentId, orgId },
      include: { lines: { include: { taxRate: true } }, organization: true, partner: true, counterSession: { include: { counter: true } } },
    });
    if (!doc) throw new NotFoundException('Ticket introuvable.');
    const rows = doc.lines.map((l) => {
      const qty = Number(l.quantity);
      const net = qty * Number(l.unitPrice) * (1 - (l.discountPercent != null ? Number(l.discountPercent) : 0) / 100);
      return { name: l.description, detail: `${qty} × ${formatMoney(Number(l.unitPrice))}`, total: round2(net * (1 + (l.taxRate ? Number(l.taxRate.rate) : 0) / 100)) };
    });
    const total = round2(rows.reduce((s, r) => s + r.total, 0));
    const o = doc.organization;
    const header = [o.name, o.address, o.phone ? `Tél : ${o.phone}` : null].filter(Boolean) as string[];
    const footer = [
      `Ticket ${doc.number}`,
      doc.issuedAt.toLocaleString('fr-FR'),
      doc.counterSession ? `Caisse : ${doc.counterSession.counter.name}` : null,
      doc.partner ? `Client : ${doc.partner.name}` : null,
      doc.paymentMethod ? `Paiement : ${METHOD_LABEL[doc.paymentMethod] ?? doc.paymentMethod}` : 'À crédit',
    ].filter(Boolean) as string[];
    return renderTicket(header, rows, [{ label: 'TOTAL', value: `${formatMoney(total)} DZD`, bold: true }], footer, 'Merci de votre visite !');
  }

  async zReportPdf(orgId: string, sessionId: string): Promise<Buffer> {
    const s = await this.summary(orgId, sessionId);
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    const header = [org.name, `TICKET Z · ${s.number}`, `Caisse : ${s.counter.name} (${s.counter.site.name})`];
    const rows = s.byMethod.map((m) => ({ name: m.label, detail: `${m.count} vente(s)`, total: m.total }));
    const summary = [
      { label: 'Ventes', value: `${s.salesCount}` },
      { label: 'Chiffre d’affaires', value: `${formatMoney(s.salesTotal)} DZD`, bold: true },
      { label: 'Fond de caisse', value: formatMoney(s.openingCash) },
      { label: 'Ventes espèces', value: formatMoney(s.cashSales) },
      { label: 'Entrées', value: formatMoney(s.cashIn) },
      { label: 'Sorties', value: formatMoney(s.cashOut) },
      { label: 'Espèces attendues', value: formatMoney(s.expectedCash), bold: true },
      ...(s.countedCash != null
        ? [
            { label: 'Espèces comptées', value: formatMoney(s.countedCash) },
            { label: 'Écart', value: formatMoney(s.difference ?? 0), bold: true },
          ]
        : []),
    ];
    const footer = [
      `Ouverture : ${new Date(s.openedAt).toLocaleString('fr-FR')}`,
      s.closedAt ? `Clôture : ${new Date(s.closedAt).toLocaleString('fr-FR')}` : 'Session encore ouverte',
      ...s.movements.map((m) => `${m.direction === 'in' ? '+' : '-'} ${formatMoney(m.amount)} ${m.reason}`),
    ];
    return renderTicket(header, rows, summary, footer, s.notes ?? '');
  }

  private async openSession(orgId: string, sessionId: string) {
    const s = await this.prisma.counterSession.findFirst({ where: { id: sessionId, orgId } });
    if (!s) throw new NotFoundException(`Session inconnue : ${sessionId}`);
    if (s.status !== 'open') throw new BadRequestException('Cette caisse est clôturée.');
    return s;
  }
}

function computeTtc(lines: { quantity: unknown; unitPrice: unknown; discountPercent: unknown; taxRate: { rate: unknown } | null }[]) {
  return round2(
    lines.reduce((sum, l) => {
      const net = Number(l.quantity) * Number(l.unitPrice) * (1 - (l.discountPercent != null ? Number(l.discountPercent) : 0) / 100);
      return sum + net * (1 + (l.taxRate ? Number(l.taxRate.rate) : 0) / 100);
    }, 0),
  );
}

/** 80 mm thermal-printer ticket: one column, height fitted to the content. */
function renderTicket(
  header: string[],
  rows: { name: string; detail: string; total: number }[],
  summary: { label: string; value: string; bold?: boolean }[],
  footer: string[],
  closing: string,
): Promise<Buffer> {
  const W = 226; // 80 mm
  const M = 10;
  const inner = W - M * 2;
  const height = 60 + header.length * 13 + rows.length * 26 + summary.length * 14 + footer.length * 11 + 40;
  const doc = new PDFDocument({ size: [W, height], margin: M });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  const rule = () => {
    doc.moveTo(M, doc.y + 3).lineTo(W - M, doc.y + 3).dash(2, { space: 2 }).strokeColor('#888').stroke().undash();
    doc.y += 8;
  };
  header.forEach((h, i) => doc.font(i === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(i === 0 ? 11 : 8).text(h, M, doc.y, { width: inner, align: 'center' }));
  rule();
  for (const r of rows) {
    doc.font('Helvetica').fontSize(8.5).text(r.name, M, doc.y, { width: inner });
    const y = doc.y;
    doc.fontSize(8).fillColor('#555').text(r.detail, M, y, { width: inner / 2 });
    doc.fillColor('#000').text(formatMoney(r.total), M + inner / 2, y, { width: inner / 2, align: 'right' });
    doc.y += 2;
  }
  rule();
  for (const s of summary) {
    const y = doc.y;
    doc.font(s.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(s.bold ? 9.5 : 8.5).text(s.label, M, y, { width: inner / 2 });
    doc.text(s.value, M + inner / 2, y, { width: inner / 2, align: 'right' });
  }
  rule();
  doc.font('Helvetica').fontSize(7.5).fillColor('#444');
  for (const f of footer) doc.text(f, M, doc.y, { width: inner, align: 'center' });
  if (closing) doc.moveDown(0.5).font('Helvetica-Oblique').text(closing, M, doc.y, { width: inner, align: 'center' });
  doc.end();
  return done;
}
