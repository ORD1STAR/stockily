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
  counterparty: { name: string; nif?: string | null } | null;
  /** Short label:value pairs rendered between the party cards and the table — e.g. site, expected date. */
  meta?: { label: string; value: string }[];
  columns: DocumentPdfColumn[];
  lines: DocumentPdfLine[];
  totalLabel?: string | null;
  totalValue?: string | null;
  footerNote: string;
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
    if (input.totalLabel && input.totalValue) this.renderTotal(doc, input.totalLabel, input.totalValue);
    this.renderFooterOnEveryPage(doc, input);

    doc.end();
    return done;
  }

  private renderHeader(doc: PDFKit.PDFDocument, input: DocumentPdfInput): void {
    const logoBuffer = parseDataUrl(input.org.logo);
    const logoSize = 36;
    const nameX = logoBuffer ? MARGIN + logoSize + 10 : MARGIN;
    if (logoBuffer) {
      doc.image(logoBuffer, MARGIN, 52, { fit: [logoSize, logoSize] });
    }
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(22).text(input.org.name, nameX, 54, { width: 300 - (nameX - MARGIN) });
    doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(20).text(input.title, MARGIN, 54, { width: CONTENT_WIDTH, align: 'right' });
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(10)
      .text(`N° ${input.number}`, MARGIN, 80, { width: CONTENT_WIDTH, align: 'right' })
      .text(input.date.toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' }), MARGIN, 94, {
        width: CONTENT_WIDTH,
        align: 'right',
      });
    if (input.referenceLine) {
      doc.fontSize(8.5).text(input.referenceLine, MARGIN, 108, { width: CONTENT_WIDTH, align: 'right' });
    }

    if (input.statusLabel) {
      const badgeWidth = doc.widthOfString(input.statusLabel.toUpperCase()) + 20;
      doc.roundedRect(RIGHT_EDGE - badgeWidth, 112, badgeWidth, 18, 3).fillAndStroke(PANEL_BG, HAIRLINE);
      doc
        .fillColor(MUTED)
        .font('Helvetica-Bold')
        .fontSize(8)
        .text(input.statusLabel.toUpperCase(), RIGHT_EDGE - badgeWidth, 117, { width: badgeWidth, align: 'center' });
    }

    doc.moveTo(MARGIN, 142).lineTo(RIGHT_EDGE, 142).lineWidth(1.5).strokeColor(BRAND).stroke();
    doc.strokeColor(INK).lineWidth(1);
    doc.y = 158;
  }

  private renderPartyCards(doc: PDFKit.PDFDocument, input: DocumentPdfInput): void {
    const top = doc.y;
    const cardWidth = (CONTENT_WIDTH - 20) / 2;
    const cardHeight = 96;

    this.drawCard(doc, MARGIN, top, cardWidth, cardHeight, 'ÉMETTEUR', [
      input.org.name,
      input.org.address,
      input.org.nif ? `NIF : ${input.org.nif}` : null,
      input.org.rc ? `RC : ${input.org.rc}` : null,
      input.org.phone,
    ]);

    this.drawCard(doc, MARGIN + cardWidth + 20, top, cardWidth, cardHeight, input.counterpartyLabel, [
      input.counterparty?.name ?? '—',
      input.counterparty?.nif ? `NIF : ${input.counterparty.nif}` : null,
    ]);

    doc.y = top + cardHeight + 20;
  }

  private drawCard(doc: PDFKit.PDFDocument, x: number, y: number, width: number, height: number, label: string, lines: (string | null)[]): void {
    doc.roundedRect(x, y, width, height, 4).fillAndStroke(PANEL_BG, HAIRLINE);
    doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(8).text(label, x + 14, y + 12, { width: width - 28, characterSpacing: 0.5 });

    let ly = y + 28;
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(10.5).text(lines[0] ?? '', x + 14, ly, { width: width - 28 });
    ly += 16;
    doc.font('Helvetica').fontSize(9).fillColor('#3a3a3a');
    for (const line of lines.slice(1)) {
      if (!line) continue;
      doc.text(line, x + 14, ly, { width: width - 28 });
      ly += 13;
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
      const firstColWidth = columns[0].width - 16;
      const descHeight = doc.heightOfString(line.cells[columns[0].key] ?? '', { width: firstColWidth });
      const rowHeight = Math.max(minRowHeight, descHeight + 14);

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
