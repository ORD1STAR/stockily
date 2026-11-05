import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TenancyModule } from '../modules/tenancy/tenancy.module';
import { LicensingModule } from '../modules/licensing/licensing.module';
import { LocalController } from './local.controller';
import { LocalStateService } from './local-state.service';
import { LocalSyncService } from './local-sync.service';
import { OnlineOnlyMiddleware } from './online-only.middleware';
import { OutboxInterceptor } from './outbox.interceptor';

// Only imported when STOCKILY_LOCAL_MODE=1 (see AppModule) — i.e. inside
// the desktop app. The server never loads any of this.
@Module({
  imports: [TenancyModule, LicensingModule],
  controllers: [LocalController],
  providers: [LocalStateService, LocalSyncService, { provide: APP_INTERCEPTOR, useClass: OutboxInterceptor }],
})
export class LocalModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(OnlineOnlyMiddleware).forRoutes('*');
  }
}
