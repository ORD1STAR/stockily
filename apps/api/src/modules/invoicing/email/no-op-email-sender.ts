import { Injectable, Logger } from '@nestjs/common';
import { EmailAttachment, EmailSenderPort } from './email-sender.port';

/** Default EmailSenderPort implementation — logs instead of sending, until a real provider is configured (see email-sender.port.ts). */
@Injectable()
export class NoOpEmailSender implements EmailSenderPort {
  private readonly logger = new Logger(NoOpEmailSender.name);

  async send(to: string, subject: string, body: string, attachments: EmailAttachment[] = []): Promise<void> {
    this.logger.warn(
      `EmailSenderPort has no real provider configured — not sending. Would have sent "${subject}" to ${to} with ${attachments.length} attachment(s). Body: ${body.slice(0, 200)}`,
    );
  }
}
