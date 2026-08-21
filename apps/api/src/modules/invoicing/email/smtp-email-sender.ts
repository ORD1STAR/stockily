import { Injectable, Logger } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';
import { EmailAttachment, EmailSenderPort } from './email-sender.port';

/**
 * Real SMTP sending, activated purely by environment configuration — see
 * invoicing.module.ts's provider factory for the SMTP_HOST-present check
 * that picks this over NoOpEmailSender. No credentials are hardcoded or
 * invented here; SMTP_HOST/PORT/USER/PASS/FROM are read from the
 * environment the same way DATABASE_URL/JWT_SECRET already are — a real
 * deployment supplies its own provider's SMTP credentials (Postmark,
 * SendGrid, SES, or a plain mailbox) and nothing else changes.
 */
@Injectable()
export class SmtpEmailSender implements EmailSenderPort {
  private readonly logger = new Logger(SmtpEmailSender.name);
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor() {
    this.from = process.env.SMTP_FROM ?? 'no-reply@stockily.dz';
    this.transporter = createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }

  async send(to: string, subject: string, body: string, attachments: EmailAttachment[] = []): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.from,
        to,
        subject,
        text: body,
        attachments: attachments.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
      });
    } catch (err) {
      // A failed reminder email is a soft failure (the invoice still
      // exists and is still overdue) — logged, not thrown, so one bad
      // address doesn't fail the whole overdue-check batch (InvoicingService
      // .runReminderCheck loops over every overdue invoice).
      this.logger.error(`Failed to send "${subject}" to ${to}`, err instanceof Error ? err.stack : err);
    }
  }
}
