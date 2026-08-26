import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { AuditModule } from '../audit/audit.module';
import { StockModule } from '../stock/stock.module';
import { QualityModule } from '../quality/quality.module';
import { PurchasingController } from './purchasing.controller';
import { PurchasingService } from './purchasing.service';

// The first Phase 2 product module (Milestone 9). Imports StockModule and
// QualityModule for their exported services — PurchasingService never
// constructs @org/domain-stock or @org/domain-quality directly, same
// discipline as every other module that composes with Stock/Quality.
@Module({
  imports: [TenancyModule, AuditModule, StockModule, QualityModule],
  controllers: [PurchasingController],
  providers: [PurchasingService],
})
export class PurchasingModule {}
