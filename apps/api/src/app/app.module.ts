import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
// AllExceptionsFilter is registered in main.ts (app.useGlobalFilters), not
// here — it has no constructor dependencies, so the simpler non-DI
// registration is enough; no need for the APP_FILTER provider token.
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
    // Generous global default (normal API usage shouldn't feel this at
    // all) — AuthController overrides it with a much stricter limit on
    // signup/login/refresh specifically, the routes actually worth
    // protecting against brute-force/credential-stuffing.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 300 }]),
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
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
