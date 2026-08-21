import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from '../prisma/prisma.module';
import { JwtConfigModule } from '../config/jwt-config.module';
import { AuthModule } from '../modules/auth/auth.module';
import { TenancyModule } from '../modules/tenancy/tenancy.module';
import { StockModule } from '../modules/stock/stock.module';
import { QualityModule } from '../modules/quality/quality.module';
import { InvoicingModule } from '../modules/invoicing/invoicing.module';
import { SitesModule } from '../modules/sites/sites.module';
import { ScanModule } from '../modules/scan/scan.module';
import { AuditModule } from '../modules/audit/audit.module';
import { RealtimeModule } from '../modules/realtime/realtime.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Single-instance only (§8 risk #4 resolution) — no Redis adapter.
    // Domain events (StockMovementCreated etc., docs/Action Plan.md §4/§5)
    // flow through this, not a second bespoke pub/sub mechanism.
    EventEmitterModule.forRoot(),
    PrismaModule,
    JwtConfigModule,
    AuthModule,
    TenancyModule,
    AuditModule,
    RealtimeModule,
    // Phase 1 product modules (docs/Action Plan.md §1, §7)
    StockModule,
    QualityModule,
    InvoicingModule,
    SitesModule,
    ScanModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
