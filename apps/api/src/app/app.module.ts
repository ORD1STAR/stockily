import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
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
import { PurchasingModule } from '../modules/purchasing/purchasing.module';
import { AuditModule } from '../modules/audit/audit.module';
import { RealtimeModule } from '../modules/realtime/realtime.module';
import { TenantContextMiddleware } from '../modules/tenancy/middleware/tenant-context.middleware';

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
    // Phase 2, Milestone 9 — the first Phase 2 product module.
    PurchasingModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  // Must run before every guard — including ModuleEntitlementGuard/
  // PermissionGuard, which query the DB themselves — so this is registered
  // as Express middleware (Milestone 8, RLS), not a Nest interceptor
  // (interceptors run after guards).
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantContextMiddleware).forRoutes('*');
  }
}
