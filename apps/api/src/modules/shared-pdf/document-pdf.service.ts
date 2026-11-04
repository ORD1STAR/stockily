import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';

// A generic "operational document" PDF generator — bon de commande, bon de
// livraison/réception, devis — sharing the same visual language as
// InvoicePdfService (brand color, party cards, striped table, repeating
// header/footer on overflow) without duplicating that file's invoice-only
// concerns (TVA breakdown, amount-in-words, the Décret 05-468 legal
// mention). Kept in its own module (not inside InvoicingModule) since
// Purchasing and Sales both need it and neither should have to import the
// other's module to get it — see PurchasingModule/SalesModule's own
// comments on why the InvoicingModule dependency stays one-directional.
export interface DocumentPdfColumn {
  key: string;
  label: string;
  width: number;
  align?: 'left' | 'right';
}

export interface DocumentPdfLine {
  cells: Record<string, string>;
}

export interface DocumentPdfInput {
  title: string;
  number: string;
  date: Date;
  statusLabel?: string | null;
  /** e.g. "Devis d'origine : DEV-2026-000001" or "Bon de commande : BC-2026-000004" — shown under the number. */
  referenceLine?: string | null;
  org: {
    name: string;
    address: string | null;
    nif: string | null;
    nis: string | null;
    rc: string | null;
    taxArticle: string | null;
    phone: string | null;
    logo: string | null;
  };
  counterpartyLabel: string;
  counterparty: PdfParty | null;
  /** Shown in the counterparty card when there is none (e.g. "Client comptoir"). */
  counterpartyFallback?: string;
  /** Short label:value pairs rendered between the party cards and the table — e.g. site, expected date. */
  meta?: { label: string; value: string }[];
  columns: DocumentPdfColumn[];
  lines: DocumentPdfLine[];
  totalLabel?: string | null;
  totalValue?: string | null;
  /** Totals panel rows (Total, Versé, Reste…); the row marked `accent` is highlighted. Replaces totalLabel/totalValue when given. */
  summary?: PdfSummaryRow[];
  /** Observation printed under the totals. */
  notes?: string | null;
  footerNote: string;
}

export interface PdfParty {
  name: string;
  code?: string | null;
  address?: string | null;
  nif?: string | null;
  rc?: string | null;
  taxArticle?: string | null;
  phone?: string | null;
}

export interface PdfSummaryRow {
  label: string;
  value: string;
  accent?: boolean;
  bold?: boolean;
  /** Draws a thin rule above this row. */
  separated?: boolean;
}

/**
 * Card lines for a party: name, then address, NIF, RC, Tél — always printed,
 * empty when unknown. `legal: false` (bons, devis, commandes…) keeps only the
 * name, address and phone: the fiscal identifiers belong on invoices only.
 */
export function partyLines(party: PdfParty | null, fallbackName: string, opts: { nis?: string | null; withTaxArticle?: boolean; legal?: boolean } = {}): (string | null)[] {
  if (opts.legal === false)
    return [party ? (party.code ? `${party.name}  (${party.code})` : party.name) : fallbackName, party?.address || null, party?.phone ? `Tél : ${party.phone}` : null];
  return [
    party ? (party.code ? `${party.name}  (${party.code})` : party.name) : fallbackName,
    party?.address || null,
    `NIF : ${party?.nif ?? ''}`,
    opts.nis ? `NIS : ${opts.nis}` : null,
    `RC : ${party?.rc ?? ''}`,
    opts.withTaxArticle || party?.taxArticle ? `AI : ${party?.taxArticle ?? ''}` : null,
    `Tél : ${party?.phone ?? ''}`,
  ];
}

/** Company name in the header: full name, wrapped, font shrunk for long names — never cut. */
export function renderOrgName(doc: PDFKit.PDFDocument, name: string, x: number, y: number, width: number): number {
  let size = 22;
  doc.font('Helvetica-Bold');
  while (size > 13 && doc.fontSize(size).heightOfString(name, { width }) > size * 2.6) size -= 1;
  doc.fontSize(size).text(name, x, y, { width });
  return y + doc.heightOfString(name, { width });
}

function parseDataUrl(dataUrl: string | null): Buffer | null {
  if (!dataUrl) return null;
  const match = /^data:image\/(?:png|jpe?g);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  try {
    return Buffer.from(match[1], 'base64');
  } catch {
    return null;
  }
}

// Same hand-rolled formatter as InvoicePdfService, duplicated rather than
// imported to keep this module independent of InvoicingModule (see this
// file's own top comment) — 'fr-FR''s U+202F thousands separator has no
// glyph in the standard Helvetica/WinAnsi font this whole document uses.
export const formatMoney = (n: number): string => {
  const [intPart, decPart] = n.toFixed(2).split('.');
  return `${intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${decPart}`;
};

const PAGE_WIDTH = 595.28;
const MARGIN = 50;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2; // 495
const RIGHT_EDGE = PAGE_WIDTH - MARGIN;
const BRAND = '#0f766e';
const INK = '#1a1a1a';
const MUTED = '#6b6b6b';
const HAIRLINE = '#d8dcdb';
const PANEL_BG = '#f4f7f6';

@Injectable()
export class DocumentPdfService {
  async generate(input: DocumentPdfInput): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

    doc.on('pageAdded', () => this.renderContinuationHeader(doc, input));

    this.renderHeader(doc, input);
    this.renderPartyCards(doc, input);
    if (input.meta && input.meta.length > 0) this.renderMeta(doc, input.meta);
    this.renderLinesTable(doc, input);
    if (input.summary && input.summary.length > 0) this.renderSummary(doc, input.summary);
    else if (input.totalLabel && input.totalValue) this.renderTotal(doc, input.totalLabel, input.totalValue);
    if (input.notes) this.renderNotes(doc, input.notes);
    this.renderFooterOnEveryPage(doc, input);

    doc.end();
    return done;
  }

  private renderHeader(doc: PDFKit.PDFDocument, input: DocumentPdfInput): void {
    const top = 50;
    const logoBuffer = parseDataUrl(input.org.logo);
    const logoSize = 48;
    const nameX = logoBuffer ? MARGIN + logoSize + 12 : MARGIN;
    if (logoBuffer) {
      doc.image(logoBuffer, MARGIN, top, { fit: [logoSize, logoSize], valign: 'center' });
    }

    // Right column flows top-down (title, N°, date, optional reference
    // line, status badge) instead of sitting at fixed y positions — fixed
    // positions put the "Devis d'origine" line and the badge on top of
    // each other. The left-hand name gets whatever width the title leaves.
    doc.font('Helvetica-Bold').fontSize(20);
    const titleWidth = doc.widthOfString(input.title);
    doc.fillColor(BRAND).text(input.title, MARGIN, top + 2, { width: CONTENT_WIDTH, align: 'right' });
    doc.fillColor(INK);
    const nameBottom = renderOrgName(doc, input.org.name, nameX, logoBuffer ? top + 8 : top, Math.max(160, RIGHT_EDGE - Math.max(titleWidth, 150) - 24 - nameX));

    let ry = top + 30;
    doc.fillColor(MUTED).font('Helvetica').fontSize(10);
    doc.text(`N° ${input.number}`, MARGIN, ry, { width: CONTENT_WIDTH, align: 'right' });
    ry += 14;
    doc.text(input.date.toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' }), MARGIN, ry, { width: CONTENT_WIDTH, align: 'right' });
    ry += 14;
    if (input.referenceLine) {
      doc.fontSize(8.5).text(input.referenceLine, MARGIN, ry, { width: CONTENT_WIDTH, align: 'right' });
      ry += 13;
    }

    let rightBottom = ry;
    if (input.statusLabel) {
      const label = input.statusLabel.toUpperCase();
      const badgeTop = ry + 4;
      doc.font('Helvetica-Bold').fontSize(8);
      const badgeWidth = doc.widthOfString(label) + 20;
      doc.roundedRect(RIGHT_EDGE - badgeWidth, badgeTop, badgeWidth, 18, 3).fillAndStroke(PANEL_BG, HAIRLINE);
      doc.fillColor(MUTED).text(label, RIGHT_EDGE - badgeWidth, badgeTop + 5, { width: badgeWidth, align: 'center', lineBreak: false });
      rightBottom = badgeTop + 18;
    }

    const ruleY = Math.max(rightBottom, top + logoSize, nameBottom) + 12;
    doc.moveTo(MARGIN, ruleY).lineTo(RIGHT_EDGE, ruleY).lineWidth(1.5).strokeColor(BRAND).stroke();
    doc.strokeColor(INK).lineWidth(1);
    doc.y = ruleY + 16;
  }

  private renderPartyCards(doc: PDFKit.PDFDocument, input: DocumentPdfInput): void {
    const top = doc.y;
    const cardWidth = (CONTENT_WIDTH - 20) / 2;
    const sellerLines = partyLines(
      { name: input.org.name, address: input.org.address, nif: input.org.nif, rc: input.org.rc, taxArticle: input.org.taxArticle, phone: input.org.phone },
      input.org.name,
      { legal: false },
    );
    const buyerLabel = input.counterpartyLabel;
    const buyerLines = partyLines(input.counterparty, input.counterpartyFallback ?? '—', { legal: false });

    // Sized to the taller card's actual content (wrapped lines included) —
    // a fixed height let a fully filled-in seller profile (address + NIF +
    // NIS + RC + article + phone) spill its last line below the card.
    const cardHeight = Math.max(72, this.cardContentHeight(doc, cardWidth, sellerLines), this.cardContentHeight(doc, cardWidth, buyerLines));
    this.drawCard(doc, MARGIN, top, cardWidth, cardHeight, 'ÉMETTEUR', sellerLines);
    this.drawCard(doc, MARGIN + cardWidth + 20, top, cardWidth, cardHeight, buyerLabel, buyerLines);

    doc.y = top + cardHeight + 20;
  }

  /** Same layout maths as drawCard below, without drawing — the card's total height including its bottom padding. */
  private cardContentHeight(doc: PDFKit.PDFDocument, width: number, lines: (string | null)[]): number {
    const textWidth = width - 28;
    let h = 28 + Math.max(16, doc.font('Helvetica-Bold').fontSize(10.5).heightOfString(lines[0] ?? '', { width: textWidth }) + 3);
    doc.font('Helvetica').fontSize(9);
    for (const line of lines.slice(1)) {
      if (!line) continue;
      h += Math.max(13, doc.heightOfString(line, { width: textWidth }) + 2);
    }
    return h + 12;
  }

  private drawCard(doc: PDFKit.PDFDocument, x: number, y: number, width: number, height: number, label: string, lines: (string | null)[]): void {
    const textWidth = width - 28;
    doc.roundedRect(x, y, width, height, 4).fillAndStroke(PANEL_BG, HAIRLINE);
    doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(8).text(label, x + 14, y + 12, { width: textWidth, characterSpacing: 0.5 });

    let ly = y + 28;
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(10.5).text(lines[0] ?? '', x + 14, ly, { width: textWidth });
    ly += Math.max(16, doc.heightOfString(lines[0] ?? '', { width: textWidth }) + 3);
    doc.font('Helvetica').fontSize(9).fillColor('#3a3a3a');
    for (const line of lines.slice(1)) {
      if (!line) continue;
      doc.text(line, x + 14, ly, { width: textWidth });
      ly += Math.max(13, doc.heightOfString(line, { width: textWidth }) + 2);
    }
  }


  private renderMeta(doc: PDFKit.PDFDocument, meta: { label: string; value: string }[]): void {
    const y = doc.y;
    doc.font('Helvetica').fontSize(9);
    let x = MARGIN;
    for (const { label, value } of meta) {
      const text = `${label} : ${value}`;
      doc.fillColor(MUTED).text(label + ' : ', x, y, { continued: true }).fillColor(INK).text(value, { continued: false });
      x += doc.widthOfString(text) + 28;
    }
    doc.y = y + 18;
    doc.fillColor(INK);
  }

  private renderTableHeaderRow(doc: PDFKit.PDFDocument, y: number, columns: DocumentPdfColumn[]): number {
    const headerHeight = 22;
    doc.rect(MARGIN, y, CONTENT_WIDTH, headerHeight).fill(BRAND);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8.5);
    let x = MARGIN;
    for (const col of columns) {
      doc.text(col.label.toUpperCase(), x + (col.align === 'right' ? 0 : 10), y + 7, { width: col.width - (col.align === 'right' ? 6 : 10), align: col.align ?? 'left' });
      x += col.width;
    }
    doc.fillColor(INK);
    return y + headerHeight;
  }

  private renderContinuationHeader(doc: PDFKit.PDFDocument, input: DocumentPdfInput): void {
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(8)
      .text(`${input.title} N° ${input.number} (suite)`, MARGIN, MARGIN, { width: CONTENT_WIDTH, align: 'right' });
    doc.y = this.renderTableHeaderRow(doc, MARGIN + 16, input.columns);
  }

  private renderLinesTable(doc: PDFKit.PDFDocument, input: DocumentPdfInput): void {
    const { columns, lines } = input;
    const minRowHeight = 24;
    const bottomLimit = doc.page.height - MARGIN - 40;

    doc.y = this.renderTableHeaderRow(doc, doc.y, columns);

    doc.font('Helvetica').fontSize(9);
    lines.forEach((line, i) => {
      // Row height = the tallest cell (any column can wrap: a long code, a long name…).
      const tallest = Math.max(
        ...columns.map((col) => doc.heightOfString(line.cells[col.key] ?? '', { width: col.width - (col.align === 'right' ? 6 : 10) })),
      );
      const rowHeight = Math.max(minRowHeight, tallest + 14);

      if (doc.y + rowHeight > bottomLimit) {
        doc.addPage();
      }
      const y = doc.y;
      if (i % 2 === 1) doc.rect(MARGIN, y, CONTENT_WIDTH, rowHeight).fill('#fafbfb');
      doc.fillColor(INK);
      let x = MARGIN;
      columns.forEach((col) => {
        const value = line.cells[col.key] ?? '';
        doc.text(value, x + (col.align === 'right' ? 0 : 10), y + 7, { width: col.width - (col.align === 'right' ? 6 : 10), align: col.align ?? 'left' });
        x += col.width;
      });
      doc
        .moveTo(MARGIN, y + rowHeight)
        .lineTo(RIGHT_EDGE, y + rowHeight)
        .strokeColor(HAIRLINE)
        .lineWidth(0.5)
        .stroke();
      doc.strokeColor(INK).lineWidth(1);
      doc.y = y + rowHeight;
    });

    doc.y += 16;
  }

  private renderTotal(doc: PDFKit.PDFDocument, label: string, value: string): void {
    const panelWidth = 240;
    const x = RIGHT_EDGE - panelWidth;
    const y = doc.y;
    const rowH = 26;
    doc.rect(x, y, panelWidth, rowH).fill(BRAND);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(11).text(label, x + 14, y + 8, { width: panelWidth - 100 });
    doc.text(value, x + panelWidth - 130, y + 8, { width: 116, align: 'right' });
    doc.fillColor(INK);
    doc.y = y + rowH + 16;
  }

  private renderSummary(doc: PDFKit.PDFDocument, rows: PdfSummaryRow[]): void {
    const panelWidth = 260;
    const x = RIGHT_EDGE - panelWidth;
    const needed = rows.length * 24 + 10;
    if (doc.y + needed > doc.page.height - MARGIN - 40) doc.addPage();
    let y = doc.y;
    for (const r of rows) {
      if (r.separated) {
        doc.moveTo(x + 10, y + 2).lineTo(RIGHT_EDGE - 10, y + 2).strokeColor(HAIRLINE).lineWidth(0.7).stroke();
        y += 6;
      }
      const h = r.accent ? 26 : 20;
      if (r.accent) doc.rect(x, y, panelWidth, h).fill(BRAND);
      doc
        .fillColor(r.accent ? '#ffffff' : r.bold ? INK : MUTED)
        .font(r.accent || r.bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(r.accent ? 11 : 9.5)
        .text(r.label, x + 12, y + (r.accent ? 8 : 5), { width: panelWidth - 130 });
      doc.text(r.value, x + panelWidth - 140, y + (r.accent ? 8 : 5), { width: 128, align: 'right' });
      y += h;
    }
    doc.strokeColor(INK).lineWidth(1).fillColor(INK);
    doc.y = y + 14;
  }

  private renderNotes(doc: PDFKit.PDFDocument, notes: string): void {
    const h = doc.font('Helvetica').fontSize(9).heightOfString(notes, { width: CONTENT_WIDTH - 28 }) + 34;
    if (doc.y + h > doc.page.height - MARGIN - 40) doc.addPage();
    const y = doc.y;
    doc.roundedRect(MARGIN, y, CONTENT_WIDTH, h, 4).fillAndStroke(PANEL_BG, HAIRLINE);
    doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(8).text('OBSERVATION', MARGIN + 14, y + 10, { characterSpacing: 0.5 });
    doc.fillColor(INK).font('Helvetica').fontSize(9).text(notes, MARGIN + 14, y + 24, { width: CONTENT_WIDTH - 28 });
    doc.y = y + h + 12;
  }

  private renderFooterOnEveryPage(doc: PDFKit.PDFDocument, input: DocumentPdfInput): void {
    const range = doc.bufferedPageRange();
    const pageCount = range.count;
    const savedBottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    for (let i = range.start; i < range.start + pageCount; i++) {
      doc.switchToPage(i);
      const y = doc.page.height - MARGIN - 20;
      doc.moveTo(MARGIN, y - 6).lineTo(RIGHT_EDGE, y - 6).strokeColor(HAIRLINE).lineWidth(0.5).stroke();
      doc.fillColor(MUTED).font('Helvetica').fontSize(7).text(input.footerNote, MARGIN, y, { width: CONTENT_WIDTH - 60, lineBreak: false });
      doc.text(`${i + 1} / ${pageCount}`, RIGHT_EDGE - 50, y, { width: 50, align: 'right', lineBreak: false });
    }

    doc.page.margins.bottom = savedBottomMargin;
  }
}
