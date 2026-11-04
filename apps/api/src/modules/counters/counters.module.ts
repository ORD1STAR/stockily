import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { AuditModule } from '../audit/audit.module';
import { TradeModule } from '../trade/trade.module';
import { CountersController } from './counters.controller';
import { CountersService } from './counters.service';

// Comptoirs (caisses) — sales go through TradeService as bons de livraison.
@Module({
  imports: [TenancyModule, AuditModule, TradeModule],
  controllers: [CountersController],
  providers: [CountersService],
})
export class CountersModule {}
