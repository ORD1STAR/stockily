import { Module } from '@nestjs/common';
import { AdminModule } from '../../admin/admin.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { AccountController, BillingCatalogController, BillingController, BillingWebhookController } from './billing.controller';
import { BillingScheduler } from './billing.scheduler';
import { BillingService } from './billing.service';
import { ChargilyService } from './chargily.service';

// Self-service subscription (Tarifs / Espace client) + the user's own
// account settings. Server-only like AdminModule (whose superuser client it
// reuses): a desktop device never sells modules — its entitlements come
// from the signed license.
@Module({
  imports: [AdminModule, TenancyModule],
  controllers: [BillingCatalogController, BillingController, BillingWebhookController, AccountController],
  providers: [BillingService, BillingScheduler, ChargilyService],
})
export class BillingModule {}
