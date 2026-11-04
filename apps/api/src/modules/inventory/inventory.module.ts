import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { AuditModule } from '../audit/audit.module';
import { StockModule } from '../stock/stock.module';
import { InvoicingModule } from '../invoicing/invoicing.module';
import { SharedPdfModule } from '../shared-pdf/shared-pdf.module';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { InventoryReminderScheduler } from './inventory-reminder.scheduler';

// Inventaires + rappel planifié. InvoicingModule is imported only for the
// shared email sender (EMAIL_SENDER).
@Module({
  imports: [TenancyModule, AuditModule, StockModule, InvoicingModule, SharedPdfModule],
  controllers: [InventoryController],
  providers: [InventoryService, InventoryReminderScheduler],
})
export class InventoryModule {}
