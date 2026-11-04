import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { AuditModule } from '../audit/audit.module';
import { StockModule } from '../stock/stock.module';
import { InvoicingModule } from '../invoicing/invoicing.module';
import { SharedPdfModule } from '../shared-pdf/shared-pdf.module';
import { TradePrintService } from './trade-print.service';
import { TradeController } from './trade.controller';
import { TradeService } from './trade.service';

// Bons de livraison / retours / versements (phase 2). Depends on Stock and
// Invoicing one-directionally, like Sales and Purchasing do.
@Module({
  imports: [TenancyModule, AuditModule, StockModule, InvoicingModule, SharedPdfModule],
  controllers: [TradeController],
  providers: [TradeService, TradePrintService],
  exports: [TradeService],
})
export class TradeModule {}
