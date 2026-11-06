import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BillingService } from './billing.service';

// Hourly: mark lapsed
// paid periods expired. The entitlement guard already refuses a module past
// its expiresAt on its own, so the status flip is bookkeeping, not security.
@Injectable()
export class BillingScheduler {
  private readonly logger = new Logger(BillingScheduler.name);

  constructor(private readonly billing: BillingService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleCron(): Promise<void> {
    const { expired } = await this.billing.markExpired();
    if (expired) this.logger.log(`Billing: ${expired} expired`);
  }
}
