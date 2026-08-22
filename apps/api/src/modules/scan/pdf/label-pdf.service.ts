import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
const bwipjs = require('bwip-js');

// "Imprimer" used to only call POST /scan/labels/:id/print, which just
// increments printedCount server-side — nothing was ever actually shown or
// printed, found by clicking it and watching nothing happen. A real
// barcode label needs a real, physically scannable barcode image (a
// keyboard-wedge scanner or the app's own BarcodeDetector reads pixels,
// not the printedCount column), so this renders one with bwip-js and lays
// it out on a small stick-on-label-sized PDF page via pdfkit, the same
// engine invoicing's own PDF export already uses.
export interface LabelPdfInput {
  codeValue: string;
  symbology: string;
  title: string;
  subtitle: string | null;
}

// Real EAN13 requires exactly a 12-13 digit numeric GTIN — this app's
// codes are SKUs/lot numbers (e.g. "EAU-MIN-6X1.5L"), so encoding as
// EAN13 fails whenever the code isn't purely numeric. Code128 encodes any
// text and is the standard choice for that case in real retail labeling,
// so it's the actual fallback here regardless of what "EAN13" the label
// was tagged with — the symbology field on the label record is UI intent,
// not a guarantee the value is EAN13-shaped.
const EAN13_PATTERN = /^\d{12,13}$/;

// pdfkit's own `openImage()` would give us this directly, but @types/pdfkit
// doesn't declare it (it exists at runtime, just untyped) — reading a PNG's
// width/height straight from its IHDR chunk (always the first chunk, always
// 13 bytes starting right after the 8-byte PNG signature + 4-byte length +
// 4-byte "IHDR" tag) avoids depending on an undocumented method at all.
function readPngDimensions(png: Buffer): { width: number; height: number } {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

@Injectable()
export class LabelPdfService {
  async render(input: LabelPdfInput): Promise<Buffer> {
    const barcodePng = await this.renderBarcode(input.codeValue, input.symbology);

    const pageWidth = 288; // 4in
    const pageHeight = 216; // 3in
    const doc = new PDFDocument({ size: [pageWidth, pageHeight], margins: { top: 16, bottom: 16, left: 16, right: 16 } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

    doc.font('Helvetica-Bold').fontSize(12).text(input.title, { align: 'center', width: pageWidth - 32 });
    if (input.subtitle) {
      doc.font('Helvetica').fontSize(8).fillColor('#555').text(input.subtitle, { align: 'center', width: pageWidth - 32 });
      doc.fillColor('#000');
    }
    doc.moveDown(0.4);

    // includetext:false on the bwip-js render below — bwip-js can bake its
    // own human-readable text under a 1D barcode, but this label draws the
    // code value itself right afterward for a consistent look across QR
    // (which bwip-js never adds text to) and 1D symbologies alike; leaving
    // bwip-js's own text on doubled it up, overlapping the two — found by
    // actually opening a Code128 label and seeing "FRO-FOND-8P" printed
    // twice, stacked on top of itself.
    const isQr = input.symbology === 'QR';
    const imgWidth = isQr ? 110 : pageWidth - 40;
    const imgX = (pageWidth - imgWidth) / 2;
    const { width: naturalWidth, height: naturalHeight } = readPngDimensions(barcodePng);
    const imgHeight = imgWidth * (naturalHeight / naturalWidth);
    doc.image(barcodePng, imgX, doc.y, { width: imgWidth });
    doc.y += imgHeight + 8;

    doc.font('Courier').fontSize(9).text(input.codeValue, { align: 'center', width: pageWidth - 32 });

    doc.end();
    return done;
  }

  private async renderBarcode(codeValue: string, symbology: string): Promise<Buffer> {
    if (symbology === 'QR') {
      return bwipjs.toBuffer({ bcid: 'qrcode', text: codeValue, scale: 4 });
    }
    if (EAN13_PATTERN.test(codeValue)) {
      return bwipjs.toBuffer({ bcid: 'ean13', text: codeValue, scale: 3, includetext: false });
    }
    return bwipjs.toBuffer({ bcid: 'code128', text: codeValue, scale: 3, height: 12, includetext: false });
  }
}
