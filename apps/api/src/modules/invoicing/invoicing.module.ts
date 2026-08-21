import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { AuditModule } from '../audit/audit.module';
import { StockModule } from '../stock/stock.module';
import { EMAIL_SENDER } from './email/email-sender.port';
import { NoOpEmailSender } from './email/no-op-email-sender';
import { InvoicePdfService } from './pdf/invoice-pdf.service';
import { InvoicingController } from './invoicing.controller';
import { InvoicingService } from './invoicing.service';

@Module({
  imports: [TenancyModule, AuditModule, StockModule],
  controllers: [InvoicingController],
  providers: [InvoicingService, InvoicePdfService, { provide: EMAIL_SENDER, useClass: NoOpEmailSender }],
})
export class InvoicingModule {}
