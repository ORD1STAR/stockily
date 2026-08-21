import { Injectable } from '@nestjs/common';
import * as path from 'node:path';
import PDFDocument from 'pdfkit';
import { amountToArabicWords, amountToFrenchWords } from '@org/domain-invoicing';

// Real PDF generation via pdfkit (not an HTML mock) — chosen over a
// headless-browser HTML-to-PDF approach (Puppeteer/Playwright) for
// footprint/reliability: no ~300MB Chromium download in this environment,
// pure-JS, fast. Trade-off, stated plainly: pdfkit/fontkit's Arabic text
// support has NOT been visually verified here (no PDF viewer available in
// this environment) — see docs/MILESTONE_4.md for what was actually
// checked (fontkit's own script-direction + Arabic glyph-shaping code
// exists and the font loads/draws without throwing) versus what wasn't
// (a human or image-diff confirming the rendered glyph order is correct).
// Recommend a visual QA pass before this ships to real customers.
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

const money = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

@Injectable()
export class InvoicePdfService {
  async generate(input: InvoicePdfInput): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

    this.renderHeader(doc, input);
    this.renderLegalBlock(doc, input);
    this.renderBuyer(doc, input);
    this.renderLinesTable(doc, input);
    this.renderTotals(doc, input);
    this.renderAmountInWords(doc, input);

    doc.end();
    return done;
  }

  private renderHeader(doc: PDFKit.PDFDocument, input: InvoicePdfInput): void {
    doc.fontSize(18).font('Helvetica-Bold').text(input.seller.name, 50, 50);
    doc
      .fontSize(20)
      .font('Helvetica-Bold')
      .text(`Facture N° ${input.number}`, 300, 50, { align: 'right' });
    doc
      .fontSize(10)
      .font('Helvetica')
      .text(input.issuedAt.toLocaleDateString('fr-FR'), 300, 75, { align: 'right' });
    doc.moveDown(2);
  }

  private renderLegalBlock(doc: PDFKit.PDFDocument, input: InvoicePdfInput): void {
    const { seller } = input;
    doc.fontSize(9).font('Helvetica');
    const lines = [
      seller.address,
      seller.nif ? `NIF: ${seller.nif}` : null,
      seller.nis ? `NIS: ${seller.nis}` : null,
      seller.rc ? `RC: ${seller.rc}` : null,
      seller.taxArticle ? `Art. imposition: ${seller.taxArticle}` : null,
      seller.phone,
    ].filter(Boolean) as string[];
    doc.text(lines.join(' — '), 50, 110, { width: 495 });
    doc.moveDown(1.5);
  }

  private renderBuyer(doc: PDFKit.PDFDocument, input: InvoicePdfInput): void {
    doc.fontSize(10).font('Helvetica-Bold').text(input.buyer ? input.buyer.name : 'Client comptant', 50, doc.y);
    if (input.buyer) {
      doc.font('Helvetica').fontSize(9).text(`NIF: ${input.buyer.nif}`);
    }
    doc.moveDown(1);
  }

  private renderLinesTable(doc: PDFKit.PDFDocument, input: InvoicePdfInput): void {
    const top = doc.y + 10;
    const cols = { desc: 50, qty: 300, unit: 350, disc: 410, tax: 460, total: 500 };

    doc.fontSize(8).font('Helvetica-Bold');
    doc.text('Désignation', cols.desc, top);
    doc.text('Qté', cols.qty, top, { width: 40, align: 'right' });
    doc.text('P.U. HT', cols.unit, top, { width: 50, align: 'right' });
    doc.text('Remise', cols.disc, top, { width: 40, align: 'right' });
    doc.text('TVA', cols.tax, top, { width: 30, align: 'right' });
    doc.text('Total HT', cols.total, top, { width: 45, align: 'right' });
    doc
      .moveTo(50, top + 14)
      .lineTo(545, top + 14)
      .stroke();

    let y = top + 20;
    doc.font('Helvetica').fontSize(8);
    for (const line of input.lines) {
      doc.text(line.description, cols.desc, y, { width: 240 });
      doc.text(String(line.quantity), cols.qty, y, { width: 40, align: 'right' });
      doc.text(money(line.unitPrice), cols.unit, y, { width: 50, align: 'right' });
      doc.text(line.discountAmount ? money(line.discountAmount) : '-', cols.disc, y, { width: 40, align: 'right' });
      doc.text(line.taxRatePercent != null ? `${line.taxRatePercent}%` : '-', cols.tax, y, { width: 30, align: 'right' });
      doc.text(money(line.netAmount), cols.total, y, { width: 45, align: 'right' });
      y += 18;
    }
    doc.moveTo(50, y).lineTo(545, y).stroke();
    doc.y = y + 10;
  }

  private renderTotals(doc: PDFKit.PDFDocument, input: InvoicePdfInput): void {
    doc.fontSize(9).font('Helvetica');
    const row = (label: string, value: string, bold = false) => {
      if (bold) doc.font('Helvetica-Bold');
      doc.text(label, 380, doc.y, { width: 100, continued: false });
      doc.text(value, 460, doc.y - doc.currentLineHeight(), { width: 85, align: 'right' });
      if (bold) doc.font('Helvetica');
    };
    row('Total HT', `${money(input.totalHt)} DZD`);
    row('Total TVA', `${money(input.totalTax)} DZD`);
    row('Total TTC', `${money(input.totalTtc)} DZD`, true);
    doc.moveDown(1.5);
  }

  private renderAmountInWords(doc: PDFKit.PDFDocument, input: InvoicePdfInput): void {
    const fr = amountToFrenchWords(input.totalTtc);
    const ar = amountToArabicWords(input.totalTtc);

    doc
      .fontSize(9)
      .font('Helvetica-Oblique')
      .text(`Arrêtée la présente facture à la somme de : ${fr}.`, 50, doc.y, { width: 495 });
    doc.moveDown(0.5);

    // Arabic — a separate font registration (Noto Naskh Arabic), since the
    // Latin fonts above have no Arabic glyphs at all. right-aligned to
    // match RTL reading direction; see this file's header comment for what
    // has and hasn't been verified about the rendering.
    doc.font(ARABIC_FONT_PATH).fontSize(11).text(ar, 50, doc.y, { width: 495, align: 'right' });
  }
}
