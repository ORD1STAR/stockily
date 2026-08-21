import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { AuditModule } from '../audit/audit.module';
import { StockModule } from '../stock/stock.module';
import { EMAIL_SENDER } from './email/email-sender.port';
import { NoOpEmailSender } from './email/no-op-email-sender';
import { SmtpEmailSender } from './email/smtp-email-sender';
import { InvoicePdfService } from './pdf/invoice-pdf.service';
import { InvoicingController } from './invoicing.controller';
import { InvoicingService } from './invoicing.service';

@Module({
  imports: [TenancyModule, AuditModule, StockModule],
  controllers: [InvoicingController],
  providers: [
    InvoicingService,
    InvoicePdfService,
    // Real SMTP once SMTP_HOST is set (any provider — Postmark/SendGrid/SES/
    // a plain mailbox), NoOpEmailSender (logs only) otherwise. A factory,
    // not a static useClass, specifically so this decision is made from
    // actual deployment config rather than needing a code change to enable.
    {
      provide: EMAIL_SENDER,
      useFactory: () => (process.env.SMTP_HOST ? new SmtpEmailSender() : new NoOpEmailSender()),
    },
  ],
})
export class InvoicingModule {}
