import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { AuditModule } from '../audit/audit.module';
import { TradeModule } from '../trade/trade.module';
import { CashController } from './cash.controller';
import { CashService } from './cash.service';

// Caisse — one journal of every encaissement / décaissement (versements on
// bons, règlements de factures, ventes comptoir, mouvements libres).
@Module({
  imports: [TenancyModule, AuditModule, TradeModule],
  controllers: [CashController],
  providers: [CashService],
})
export class CashModule {}
