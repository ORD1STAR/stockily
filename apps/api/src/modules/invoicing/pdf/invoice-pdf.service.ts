import { Injectable } from '@nestjs/common';
import * as path from 'node:path';
import PDFDocument from 'pdfkit';
import { amountToArabicWords, amountToFrenchWords } from '@org/domain-invoicing';

// Real PDF generation via pdfkit (not an HTML mock) — chosen over a
// headless-browser HTML-to-PDF approach (Puppeteer/Playwright) for
// footprint/reliability: no ~300MB Chromium download in this environment,
// pure-JS, fast.
//
// __non_webpack_require__ (not require.resolve) is load-bearing in the
// webpack-bundled runtime, not stylistic: webpack intercepts
// require.resolve() in a Node-target bundle and can replace it with its
// own internal numeric module id instead of a real filesystem path —
// confirmed by hitting exactly that failure (`path.join` receiving a
// number) when this used plain require.resolve under `nx serve`/the built
// image. But __non_webpack_require__ only exists inside an actual webpack
// bundle — it's a ReferenceError under Jest (ts/swc-transpiled source, no
// webpack involved at all), so fall back to plain require.resolve there.
declare const __non_webpack_require__: NodeRequire | undefined;
const resolvePackageJson: (id: string) => string =
  typeof __non_webpack_require__ !== 'undefined' ? __non_webpack_require__.resolve : require.resolve;
const ARABIC_FONT_PATH = path.join(
  resolvePackageJson('@fontsource/noto-naskh-arabic/package.json'),
  '..',
  'files',
  'noto-naskh-arabic-arabic-400-normal.woff',
);

export interface InvoicePdfLine {
  description: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  taxRatePercent: number | null;
  netAmount: number;
  taxAmount: number;
  totalAmount: number;
}

export interface InvoicePdfInput {
  number: string;
  issuedAt: Date;
  type: 'CUSTOMER' | 'SUPPLIER';
  status: string;
  seller: {
    name: string;
    address: string | null;
    nif: string | null;
    nis: string | null;
    rc: string | null;
    taxArticle: string | null;
    phone: string | null;
  };
  buyer: { name: string; nif: string } | null; // null = vente comptoir
  lines: InvoicePdfLine[];
  totalHt: number;
  totalTax: number;
  totalTtc: number;
}

// Layout constants — A4 (595 x 842pt), 50pt margins → 495pt content width.
const PAGE_WIDTH = 595.28;
const MARGIN = 50;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2; // 495
const RIGHT_EDGE = PAGE_WIDTH - MARGIN; // 545
const BRAND = '#0f766e'; // teal — matches the app's own brand accent
const INK = '#1a1a1a';
const MUTED = '#6b6b6b';
const HAIRLINE = '#d8dcdb';
const PANEL_BG = '#f4f7f6';

const STATUS_LABEL_FR: Record<string, string> = {
  draft: 'Brouillon',
  unpaid: 'Impayée',
  partially_paid: 'Partiellement payée',
  paid: 'Payée',
  void: 'Annulée',
};

// A hand-rolled formatter, not n.toLocaleString('fr-FR', ...): that locale
// inserts U+202F (narrow no-break space) as its thousands separator, a
// glyph the standard Helvetica/WinAnsi font used throughout this PDF
// doesn't have — it rendered as a stray "/" between every group of three
// digits. Found by actually reading a generated PDF, not by reading the
// code (the string looked completely correct in a plain console.log).
const money = (n: number): string => {
  const [intPart, decPart] = n.toFixed(2).split('.');
  return `${intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${decPart}`;
};

/**
 * A full-page, spacious A4 layout — deliberately not the previous
 * cramped single-column version, which packed the seller's legal block,
 * buyer, table, and totals into a narrow strip against the left margin
 * with 18pt row heights. Found to be genuinely bad by opening a real
 * generated invoice: it looked like a rough draft, not a document a
 * business would hand to a client. This version uses the full 495pt
 * content width (side-by-side seller/buyer cards, a properly spaced
 * table, a right-aligned totals panel) and a repeating table header if a
 * very long invoice overflows onto a second page — pdfkit paginates
 * naturally, so a normal invoice (a handful of lines) still renders on
 * exactly one page without anything forcing it to.
 */
@Injectable()
export class InvoicePdfService {
  async generate(input: InvoicePdfInput): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

    // Repeat the table's column header on every page a long invoice spills
    // onto — pdfkit's own 'pageAdded' event, not manual page-break math.
    doc.on('pageAdded', () => this.renderContinuationHeader(doc, input));

    this.renderHeader(doc, input);
    this.renderPartyCards(doc, input);
    this.renderLinesTable(doc, input);
    this.renderTotalsPanel(doc, input);
    this.renderAmountInWords(doc, input);
    this.renderFooterOnEveryPage(doc, input);

    doc.end();
    return done;
  }

  private renderHeader(doc: PDFKit.PDFDocument, input: InvoicePdfInput): void {
    const title = input.type === 'SUPPLIER' ? 'FACTURE FOURNISSEUR' : 'FACTURE';

    doc.fillColor(INK).font('Helvetica-Bold').fontSize(22).text(input.seller.name, MARGIN, 54, { width: 300 });
    doc
      .fillColor(BRAND)
      .font('Helvetica-Bold')
      .fontSize(20)
      .text(title, MARGIN, 54, { width: CONTENT_WIDTH, align: 'right' });
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(10)
      .text(`N° ${input.number}`, MARGIN, 80, { width: CONTENT_WIDTH, align: 'right' })
      .text(input.issuedAt.toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' }), MARGIN, 94, {
        width: CONTENT_WIDTH,
        align: 'right',
      });

    const statusLabel = STATUS_LABEL_FR[input.status] ?? input.status;
    const badgeWidth = doc.widthOfString(statusLabel.toUpperCase()) + 20;
    doc
      .roundedRect(RIGHT_EDGE - badgeWidth, 112, badgeWidth, 18, 3)
      .fillAndStroke(input.status === 'paid' ? '#e3f5ef' : input.status === 'unpaid' ? '#fdecec' : PANEL_BG, HAIRLINE);
    doc
      .fillColor(input.status === 'paid' ? '#0f766e' : input.status === 'unpaid' ? '#b91c1c' : MUTED)
      .font('Helvetica-Bold')
      .fontSize(8)
      .text(statusLabel.toUpperCase(), RIGHT_EDGE - badgeWidth, 117, { width: badgeWidth, align: 'center' });

    doc.moveTo(MARGIN, 142).lineTo(RIGHT_EDGE, 142).lineWidth(1.5).strokeColor(BRAND).stroke();
    doc.strokeColor(INK).lineWidth(1);
    doc.y = 158;
  }

  private renderPartyCards(doc: PDFKit.PDFDocument, input: InvoicePdfInput): void {
    const top = doc.y;
    const cardWidth = (CONTENT_WIDTH - 20) / 2;
    const cardHeight = 108;

    this.drawCard(doc, MARGIN, top, cardWidth, cardHeight, 'ÉMETTEUR', [
      input.seller.name,
      input.seller.address,
      input.seller.nif ? `NIF : ${input.seller.nif}` : null,
      input.seller.nis ? `NIS : ${input.seller.nis}` : null,
      input.seller.rc ? `RC : ${input.seller.rc}` : null,
      input.seller.taxArticle ? `Article d'imposition : ${input.seller.taxArticle}` : null,
      input.seller.phone,
    ]);

    this.drawCard(doc, MARGIN + cardWidth + 20, top, cardWidth, cardHeight, input.type === 'SUPPLIER' ? 'FOURNISSEUR' : 'CLIENT', [
      input.buyer ? input.buyer.name : 'Vente comptoir',
      input.buyer ? `NIF : ${input.buyer.nif}` : 'Client sans compte (vente au comptant)',
    ]);

    doc.y = top + cardHeight + 26;
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

  private tableColumns() {
    // Sums to CONTENT_WIDTH (495): 195 + 45 + 65 + 55 + 40 + 95 = 495
    const desc = { x: MARGIN, width: 195 };
    const qty = { x: desc.x + desc.width, width: 45 };
    const unit = { x: qty.x + qty.width, width: 65 };
    const disc = { x: unit.x + unit.width, width: 55 };
    const tax = { x: disc.x + disc.width, width: 40 };
    const total = { x: tax.x + tax.width, width: 95 };
    return { desc, qty, unit, disc, tax, total };
  }

  private renderTableHeaderRow(doc: PDFKit.PDFDocument, y: number): number {
    const cols = this.tableColumns();
    const headerHeight = 22;
    doc.rect(MARGIN, y, CONTENT_WIDTH, headerHeight).fill(BRAND);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8.5);
    const ty = y + 7;
    doc.text('DÉSIGNATION', cols.desc.x + 10, ty, { width: cols.desc.width - 10 });
    doc.text('QTÉ', cols.qty.x, ty, { width: cols.qty.width - 6, align: 'right' });
    doc.text('P.U. HT', cols.unit.x, ty, { width: cols.unit.width - 6, align: 'right' });
    doc.text('REMISE', cols.disc.x, ty, { width: cols.disc.width - 6, align: 'right' });
    doc.text('TVA', cols.tax.x, ty, { width: cols.tax.width - 6, align: 'right' });
    doc.text('TOTAL HT', cols.total.x, ty, { width: cols.total.width - 10, align: 'right' });
    doc.fillColor(INK);
    return y + headerHeight;
  }

  private renderContinuationHeader(doc: PDFKit.PDFDocument, input: InvoicePdfInput): void {
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(8)
      .text(`Facture N° ${input.number} (suite)`, MARGIN, MARGIN, { width: CONTENT_WIDTH, align: 'right' });
    doc.y = this.renderTableHeaderRow(doc, MARGIN + 16);
  }

  private renderLinesTable(doc: PDFKit.PDFDocument, input: InvoicePdfInput): void {
    const cols = this.tableColumns();
    const minRowHeight = 24;
    const bottomLimit = doc.page.height - MARGIN - 40; // leaves room for the footer band

    doc.y = this.renderTableHeaderRow(doc, doc.y);

    doc.font('Helvetica').fontSize(9);
    input.lines.forEach((line, i) => {
      // A long description wraps to several lines — a fixed row height
      // would either clip it or draw the row divider straight through the
      // wrapped text. Measure it first and let the row grow to fit.
      const descHeight = doc.heightOfString(line.description, { width: cols.desc.width - 16 });
      const rowHeight = Math.max(minRowHeight, descHeight + 14);

      if (doc.y + rowHeight > bottomLimit) {
        doc.addPage(); // triggers renderContinuationHeader via the 'pageAdded' listener
      }
      const y = doc.y;
      if (i % 2 === 1) doc.rect(MARGIN, y, CONTENT_WIDTH, rowHeight).fill('#fafbfb');
      doc.fillColor(INK);
      doc.text(line.description, cols.desc.x + 10, y + 7, { width: cols.desc.width - 16 });
      doc.text(String(line.quantity), cols.qty.x, y + 7, { width: cols.qty.width - 6, align: 'right' });
      doc.text(money(line.unitPrice), cols.unit.x, y + 7, { width: cols.unit.width - 6, align: 'right' });
      // A plain ASCII hyphen, not U+2212 (MINUS SIGN) — that glyph isn't in
      // the standard Helvetica/WinAnsi encoding either, same class of bug
      // as money()'s thousands separator, found the same way (reading a
      // generated PDF): it rendered as a garbled quote-like mark.
      doc.text(line.discountAmount ? `- ${money(line.discountAmount)}` : '—', cols.disc.x, y + 7, { width: cols.disc.width - 6, align: 'right' });
      doc.text(line.taxRatePercent != null ? `${line.taxRatePercent}%` : '—', cols.tax.x, y + 7, { width: cols.tax.width - 6, align: 'right' });
      doc.font('Helvetica-Bold').text(money(line.netAmount), cols.total.x, y + 7, { width: cols.total.width - 10, align: 'right' });
      doc.font('Helvetica');
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

  private renderTotalsPanel(doc: PDFKit.PDFDocument, input: InvoicePdfInput): void {
    const panelWidth = 240;
    const x = RIGHT_EDGE - panelWidth;
    let y = doc.y;
    const rowH = 20;

    const row = (label: string, value: string, opts: { bold?: boolean; accent?: boolean } = {}) => {
      if (opts.accent) doc.rect(x, y, panelWidth, rowH + 6).fill(BRAND);
      doc
        .fillColor(opts.accent ? '#ffffff' : opts.bold ? INK : MUTED)
        .font(opts.bold || opts.accent ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(opts.accent ? 11 : 9.5)
        .text(label, x + 14, y + (opts.accent ? 9 : 5), { width: panelWidth - 100 });
      doc.text(`${value} DZD`, x + panelWidth - 130, y + (opts.accent ? 9 : 5), { width: 116, align: 'right' });
      y += opts.accent ? rowH + 6 : rowH;
    };

    row('Total HT', money(input.totalHt));
    row('TVA', money(input.totalTax));
    doc
      .moveTo(x + 14, y + 2)
      .lineTo(x + panelWidth - 14, y + 2)
      .strokeColor(HAIRLINE)
      .stroke();
    y += 8;
    row('TOTAL TTC', money(input.totalTtc), { accent: true });

    doc.fillColor(INK);
    doc.y = y + 14;
  }

  private renderAmountInWords(doc: PDFKit.PDFDocument, input: InvoicePdfInput): void {
    const fr = amountToFrenchWords(input.totalTtc);
    const ar = amountToArabicWords(input.totalTtc);

    const boxTop = doc.y;
    const padding = 14;
    // Estimate height from wrapped French text height + a fixed Arabic line allowance.
    const frHeight = doc.font('Helvetica-Oblique').fontSize(9).heightOfString(`Arrêtée la présente facture à la somme de : ${fr}.`, {
      width: CONTENT_WIDTH - padding * 2,
    });
    const boxHeight = frHeight + 40;

    doc.roundedRect(MARGIN, boxTop, CONTENT_WIDTH, boxHeight, 4).fillAndStroke(PANEL_BG, HAIRLINE);
    doc
      .fillColor(INK)
      .font('Helvetica-Oblique')
      .fontSize(9)
      .text(`Arrêtée la présente facture à la somme de : ${fr}.`, MARGIN + padding, boxTop + padding, { width: CONTENT_WIDTH - padding * 2 });

    // Arabic — a separate font registration (Noto Naskh Arabic), since the
    // Latin fonts above have no Arabic glyphs at all. Right-aligned to
    // match RTL reading direction.
    doc
      .font(ARABIC_FONT_PATH)
      .fontSize(11)
      .text(ar, MARGIN + padding, boxTop + padding + frHeight + 6, { width: CONTENT_WIDTH - padding * 2, align: 'right' });

    doc.font('Helvetica');
    doc.y = boxTop + boxHeight + 16;
  }

  /** A thin legal footer, repeated on every page (buffered pages let us stamp after layout is done). */
  private renderFooterOnEveryPage(doc: PDFKit.PDFDocument, input: InvoicePdfInput): void {
    void input;
    // Captured once, up front: drawing on page N must never itself create
    // page N+1. It did — `.text()` auto-page-breaks when it would cross
    // the bottom margin, and this footer's y sat a few points BELOW that
    // margin, so every single-line invoice ended up 3 pages long (two
    // near-blank ones, each triggering the next). Found by actually reading
    // a generated PDF, not by reading the code. Fixed two ways: keep the
    // footer's y safely inside the margin, and zero the bottom margin for
    // the duration of this draw as a defense-in-depth against the same
    // class of bug if the text ever grows (a longer legal mention, a
    // smaller page size, etc.).
    const range = doc.bufferedPageRange();
    const pageCount = range.count;
    const savedBottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    for (let i = range.start; i < range.start + pageCount; i++) {
      doc.switchToPage(i);
      const y = doc.page.height - MARGIN - 20; // comfortably inside the printable area
      doc.moveTo(MARGIN, y - 6).lineTo(RIGHT_EDGE, y - 6).strokeColor(HAIRLINE).lineWidth(0.5).stroke();
      doc
        .fillColor(MUTED)
        .font('Helvetica')
        .fontSize(7)
        .text(
          `Facture émise conformément au Décret exécutif n° 05-468. Document à conserver 10 ans (Code de commerce, art. 12).`,
          MARGIN,
          y,
          { width: CONTENT_WIDTH - 60, lineBreak: false },
        );
      doc.text(`${i + 1} / ${pageCount}`, RIGHT_EDGE - 50, y, { width: 50, align: 'right', lineBreak: false });
    }

    doc.page.margins.bottom = savedBottomMargin;
  }
}
