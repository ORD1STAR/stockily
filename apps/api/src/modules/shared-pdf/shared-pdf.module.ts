import { Module } from '@nestjs/common';
import { DocumentPdfService } from './document-pdf.service';

// Imported by PurchasingModule and SalesModule for bon de commande / bon de
// livraison printing — see DocumentPdfService's own comment for why this
// lives outside InvoicingModule.
@Module({
  providers: [DocumentPdfService],
  exports: [DocumentPdfService],
})
export class SharedPdfModule {}
