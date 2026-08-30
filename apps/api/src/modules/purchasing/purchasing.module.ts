import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { AuditModule } from '../audit/audit.module';
import { StockModule } from '../stock/stock.module';
import { QualityModule } from '../quality/quality.module';
import { InvoicingModule } from '../invoicing/invoicing.module';
import { SharedPdfModule } from '../shared-pdf/shared-pdf.module';
import { PurchasingController } from './purchasing.controller';
import { PurchasingService } from './purchasing.service';

// The first Phase 2 product module (Milestone 9), extended in Milestone 10
// (RFQ, coût de revient, facture fournisseur orchestration). Imports
// StockModule/QualityModule/InvoicingModule for their exported services —
// PurchasingService never constructs @org/domain-stock or
// @org/domain-quality directly, same discipline as every other module that
// composes with Stock/Quality; same one-directional rule as SalesModule
// for InvoicingModule (see that module's own comment on why the reverse
// import must never happen).
@Module({
  imports: [TenancyModule, AuditModule, StockModule, QualityModule, InvoicingModule, SharedPdfModule],
  controllers: [PurchasingController],
  providers: [PurchasingService],
})
export class PurchasingModule {}
