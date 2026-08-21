import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { AuditModule } from '../audit/audit.module';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';

// Real controllers/services land here per Action Plan §1/§7 Milestone 2.
// StockService is exported specifically so SitesModule can call it for
// transfers — it is the ONLY thing allowed to construct
// @org/domain-stock's StockMovementService (see stock.service.ts's own
// comment); Quality/Invoicing/Scan in later milestones do the same rather
// than reaching into @org/domain-stock directly themselves.
@Module({
  imports: [TenancyModule, AuditModule],
  controllers: [StockController],
  providers: [StockService],
  exports: [StockService],
})
export class StockModule {}
