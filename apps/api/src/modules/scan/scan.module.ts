import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { AuditModule } from '../audit/audit.module';
import { ScanController } from './scan.controller';
import { ScanService } from './scan.service';

// Real controllers/services (Action Plan §1/§7 milestone 5). No StockModule
// or QualityModule import here — Scan's own backend surface is only label
// generation/lookup/resolve (see scan.service.ts's own comment); the
// actual movement/batch/check creation a scan triggers goes straight
// through Stock's and Quality's existing endpoints, called directly from
// the frontend, exactly as Action Plan §5 describes ("Scan just calls the
// existing POST /stock-movements... not a distinct domain").
@Module({
  imports: [TenancyModule, AuditModule],
  controllers: [ScanController],
  providers: [ScanService],
})
export class ScanModule {}
