import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { setTenantOnTransaction } from '@org/infra-db';
import { PrismaService } from '../../prisma/prisma.service';
import { EMAIL_SENDER, EmailSenderPort } from '../invoicing/email/email-sender.port';
import { InventoryService } from './inventory.service';

/**
 * Daily at 08:00: for every organization whose inventory reminder is due,
 * send one email to the company address (Paramètres du business) — at most
 * once per due period. The in-app reminder (Accueil, Stock) doesn't depend
 * on this job: it's computed live from GET /inventory/reminder.
 */
@Injectable()
export class InventoryReminderScheduler {
  private readonly logger = new Logger(InventoryReminderScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    @Inject(EMAIL_SENDER) private readonly email: EmailSenderPort,
  ) {}

  @Cron('0 8 * * *')
  async handleCron(): Promise<void> {
    // The server sends reminders; every desktop device doing it too would
    // email the org once per poste.
    if (process.env.STOCKILY_LOCAL_MODE === '1') return;
    const orgs = await this.prisma.organization.findMany({
      where: { inventoryReminder: { not: 'off' } },
      select: { id: true, name: true, email: true, inventoryReminderLastSentAt: true },
    });
    for (const org of orgs) {
      try {
        const status = await this.inventory.reminderStatus(org.id);
        if (!status.isDue || !status.dueAt || !org.email) continue;
        if (org.inventoryReminderLastSentAt && org.inventoryReminderLastSentAt >= status.dueAt) continue;
        await this.email.send(
          org.email,
          'Rappel : inventaire à faire',
          `Bonjour,\n\nL’inventaire de ${org.name} est à faire (${status.frequencyLabel.toLowerCase()}).` +
            (status.lastInventoryAt ? ` Dernier inventaire validé le ${status.lastInventoryAt.toLocaleDateString('fr-FR')}.` : ' Aucun inventaire validé pour le moment.') +
            `\n\nOuvrez Stockily → Stock → Inventaire pour le lancer.\n\nStockily`,
        );
        await this.prisma.$transaction(async (tx) => {
          await setTenantOnTransaction(tx, org.id);
          await tx.organization.update({ where: { id: org.id }, data: { inventoryReminderLastSentAt: new Date() } });
        });
      } catch (err) {
        this.logger.error(`Inventory reminder failed for org ${org.id}`, err instanceof Error ? err.stack : err);
      }
    }
  }
}
