import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { AuditModule } from '../audit/audit.module';
import { StockModule } from '../stock/stock.module';
import { SitesController } from './sites.controller';
import { SitesService } from './sites.service';

// Real controllers/services land here per Action Plan §1/§7 Milestone 2.
// Imports StockModule for StockService — transfers move the stock ledger
// through it rather than duplicating @org/domain-stock's wiring here.
@Module({
  imports: [TenancyModule, AuditModule, StockModule],
  controllers: [SitesController],
  providers: [SitesService],
})
export class SitesModule {}
