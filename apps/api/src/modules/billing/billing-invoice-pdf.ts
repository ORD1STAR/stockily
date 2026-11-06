import PDFDocument from 'pdfkit';

// The invoice a customer gets from STOCKILY for their subscription (Espace
// client). Deliberately NOT the layout of the invoices the app produces for a
// business's own customers: compact A5, violet brand, one clear total, no
// "reste à payer" / payment-status block (a subscription invoice is always
// settled when it is issued).

export interface BillingInvoiceInput {
  number: string;
  kind: 'purchase' | 'topup' | 'renewal' | string;
  date: Date;
  customer: { name: string; email: string | null; phone: string | null };
  method: string | null;
  items: { label: string; months: number; unitPrice: number; total: number }[];
  total: number;
  pack: string | null;
  checkoutId?: string | null;
  trackId?: string | null;
  fmtMoney: (n: number) => string;
}

const VIOLET = '#5a3bcc';
const DARK = '#16151f';
const MUTED = '#747386';
const LINE = '#e6e6eb';
const TITLE: Record<string, string> = { purchase: 'FACTURE', renewal: 'FACTURE', topup: 'REÇU' };

export function renderBillingInvoice(input: BillingInvoiceInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // A5 portrait: condensed on purpose.
    const doc = new PDFDocument({ size: 'A5', margin: 30, info: { Title: `${input.number}`, Author: 'Stockily' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const L = doc.page.margins.left;
    const W = doc.page.width - L - doc.page.margins.right;
    const bottom = doc.page.height - doc.page.margins.bottom;

    // Header: brand on the left, document id on the right.
    doc.roundedRect(L, 30, 26, 26, 7).fill(VIOLET);
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(15).text('S', L, 36, { width: 26, align: 'center' });
    doc.fillColor(DARK).font('Helvetica-Bold').fontSize(15).text('Stockily', L + 34, 34, { lineBreak: false });
    doc.fillColor(MUTED).font('Helvetica').fontSize(7.5).text('par Ordi-Tech', L + 34, 50, { lineBreak: false });

    doc.fillColor(VIOLET).font('Helvetica-Bold').fontSize(9).text(TITLE[input.kind] ?? 'FACTURE', L, 33, { width: W, align: 'right' });
    doc.fillColor(DARK).font('Helvetica-Bold').fontSize(12).text(input.number, L, 44, { width: W, align: 'right' });
    doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(input.date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }), L, 59, { width: W, align: 'right' });

    // Customer + settlement, side by side.
    let y = 86;
    doc.moveTo(L, y).lineTo(L + W, y).lineWidth(0.6).strokeColor(LINE).stroke();
    y += 10;
    const colW = W / 2 - 6;
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(6.5).text('FACTURÉ À', L, y, { width: colW, characterSpacing: 0.6 });
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(6.5).text('RÈGLEMENT', L + W / 2 + 6, y, { width: colW, characterSpacing: 0.6 });
    y += 11;
    const startY = y;
    doc.fillColor(DARK).font('Helvetica-Bold').fontSize(9.5).text(input.customer.name, L, y, { width: colW });
    let leftY = doc.y + 1;
    doc.fillColor(MUTED).font('Helvetica').fontSize(8.5);
    if (input.customer.email) {
      doc.text(input.customer.email, L, leftY, { width: colW });
      leftY = doc.y;
    }
    if (input.customer.phone) {
      doc.text(input.customer.phone, L, leftY, { width: colW });
      leftY = doc.y;
    }
    doc.fillColor(DARK).font('Helvetica').fontSize(8.5).text(input.method ?? 'Solde Stockily', L + W / 2 + 6, startY, { width: colW });
    if (input.pack) {
      doc.fillColor(MUTED).fontSize(8).text(input.pack, L + W / 2 + 6, doc.y + 1, { width: colW });
    }
    if (input.checkoutId) {
      doc.fillColor(MUTED).font('Helvetica').fontSize(7).text(`Checkout ID : ${input.checkoutId}`, L + W / 2 + 6, doc.y + 2, { width: colW });
    }
    if (input.trackId) {
      doc.fillColor(MUTED).font('Helvetica').fontSize(7).text(`Track ID : ${input.trackId}`, L + W / 2 + 6, doc.y + 1, { width: colW });
    }
    y = Math.max(leftY, doc.y) + 12;

    // Items: label (+ unit price line) | durée | montant.
    const cDur = 62;
    const cAmt = 82;
    const cLab = W - cDur - cAmt;
    doc.rect(L, y, W, 17).fill('#f4f1fe');
    doc.fillColor(VIOLET).font('Helvetica-Bold').fontSize(7.2);
    doc.text('DÉSIGNATION', L + 7, y + 5.5, { width: cLab, characterSpacing: 0.4 });
    doc.text('DURÉE', L + cLab, y + 5.5, { width: cDur, align: 'right', characterSpacing: 0.4 });
    doc.text('MONTANT', L + cLab + cDur, y + 5.5, { width: cAmt - 7, align: 'right', characterSpacing: 0.4 });
    y += 17;

    for (const it of input.items) {
      doc.font('Helvetica-Bold').fontSize(9);
      const h1 = doc.heightOfString(it.label, { width: cLab - 10 });
      const sub = it.months && it.unitPrice ? `${input.fmtMoney(it.unitPrice)} par mois` : '';
      const rowH = Math.max(22, h1 + (sub ? 11 : 0) + 10);
      if (y + rowH > bottom - 90) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      doc.fillColor(DARK).font('Helvetica-Bold').fontSize(9).text(it.label, L + 7, y + 6, { width: cLab - 10 });
      if (sub) doc.fillColor(MUTED).font('Helvetica').fontSize(7.5).text(sub, L + 7, y + 6 + h1 + 1, { width: cLab - 10 });
      doc.fillColor(DARK).font('Helvetica').fontSize(9).text(it.months ? `${it.months} mois` : '', L + cLab, y + 6, { width: cDur, align: 'right' });
      doc.fillColor(DARK).font('Helvetica-Bold').fontSize(9).text(input.fmtMoney(it.total), L + cLab + cDur, y + 6, { width: cAmt - 7, align: 'right' });
      y += rowH;
      doc.moveTo(L, y).lineTo(L + W, y).lineWidth(0.5).strokeColor(LINE).stroke();
    }

    // One clear total, no balance due.
    y += 10;
    const boxW = 170;
    const bx = L + W - boxW;
    doc.roundedRect(bx, y, boxW, 30, 8).fill(VIOLET);
    doc.fillColor('#fff').font('Helvetica').fontSize(8.5).text('Total', bx + 12, y + 11, { lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(13).text(input.fmtMoney(input.total), bx, y + 8.5, { width: boxW - 12, align: 'right' });
    y += 38;
    if (input.method?.includes('à venir')) {
      doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(7.5).text('Activation offerte pendant le lancement : le paiement en ligne arrive bientôt.', L, y, { width: W, align: 'right' });
    }

    // Footer pinned to the bottom of the page.
    doc.moveTo(L, bottom - 22).lineTo(L + W, bottom - 22).lineWidth(0.5).strokeColor(LINE).stroke();
    doc.fillColor(MUTED).font('Helvetica').fontSize(7).text('Merci de votre confiance · Stockily, Ordi-Tech · stockily.ordi-tech.com', L, bottom - 15, { width: W, align: 'center', lineBreak: false });
    doc.end();
  });
}
