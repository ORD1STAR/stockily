import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { QualityService } from './quality.service';

/**
 * Periodic near-expiry alerting + auto-quarantine-on-expiry, per
 * docs/Action Plan.md §3/§9 decision #6. Hourly is a placeholder cadence —
 * nothing in the plan pins down a specific interval, and expiry dates move
 * in days, not minutes, so hourly is conservative without being wasteful.
 * QualityController's GET /quality/expiry-alerts also runs the same sweep
 * on-demand (see QualityService.listExpiryAlerts), so this being idle in a
 * dev/test environment where the scheduler never fires doesn't leave data
 * stale for a manual check.
 */
@Injectable()
export class ExpirySweepScheduler {
  private readonly logger = new Logger(ExpirySweepScheduler.name);

  constructor(
    private readonly quality: QualityService,
    private readonly prisma: PrismaService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleCron(): Promise<void> {
    const orgs = await this.prisma.organization.findMany({ select: { id: true } });
    for (const org of orgs) {
      try {
        await this.quality.listExpiryAlerts(org.id);
      } catch (err) {
        this.logger.error(`Expiry sweep failed for org ${org.id}`, err instanceof Error ? err.stack : err);
      }
    }
  }
}
