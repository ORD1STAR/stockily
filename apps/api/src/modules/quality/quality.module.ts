import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TenancyModule } from '../tenancy/tenancy.module';
import { AuditModule } from '../audit/audit.module';
import { StockModule } from '../stock/stock.module';
import { QualityController } from './quality.controller';
import { QualityService } from './quality.service';
import { ExpirySweepScheduler } from './expiry-sweep.scheduler';

// Real controllers/services (Action Plan §1/§7 Milestone 3). Imports
// StockModule for its exported StockService — this is the one and only
// cross-module dependency Quality has (quarantine orchestration); it does
// NOT import anything from @org/domain-stock directly, same discipline as
// @org/domain-quality itself. ScheduleModule.forRoot() here (not in
// AppModule) since the periodic sweep is entirely a Quality concern — no
// other module currently needs @nestjs/schedule, so it isn't registered
// globally.
@Module({
  imports: [TenancyModule, AuditModule, StockModule, ScheduleModule.forRoot()],
  controllers: [QualityController],
  providers: [QualityService, ExpirySweepScheduler],
  // Exported for Milestone 9's PurchasingModule, which reuses
  // recordQualityCheck/createBatch for its receiving flow exactly like
  // Scan already does at the HTTP layer — same reasoning as StockModule
  // exporting StockService (see that module's own comment).
  exports: [QualityService],
})
export class QualityModule {}
