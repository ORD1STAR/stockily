import { Injectable, Logger } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';
import { MailContent } from './mail.templates';

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface SentMail {
  to: string;
  subject: string;
  at: Date;
  /** Plain-text body, kept only in MAIL_HOST=json mode so tests can read the one-time codes. */
  text?: string;
  /** Attachment file names and sizes (always kept: no secrets in there). */
  attachments?: { filename: string; bytes: number; pdf: boolean }[];
}

/**
 * Stockily's own transactional email (welcome, payment received…).
 * Configured with MAIL_* (deliberately not SMTP_*, which drives the invoice
 * reminders organisations send to their customers — turning those on is a
 * separate decision). Without MAIL_HOST nothing is sent. MAIL_HOST=json
 * builds messages without any network (used by tests; see `sent`).
 *
 * Sending never throws: an email problem must not fail a signup or a payment.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;
  private built = false;
  /** Last messages handed to the transport (bounded; for tests and diagnostics). */
  readonly sent: SentMail[] = [];

  enabled(): boolean {
    return !!process.env.MAIL_HOST;
  }

  private transport(): Transporter | null {
    if (this.built) return this.transporter;
    const host = process.env.MAIL_HOST;
    if (!host) return null; // not cached: configuration may appear later (tests)
    this.built = true;
    if (host === 'json') {
      this.transporter = createTransport({ jsonTransport: true });
    } else {
      const port = Number(process.env.MAIL_PORT ?? 465);
      this.transporter = createTransport({
        host,
        port,
        secure: (process.env.MAIL_SECURE ?? String(port === 465)) === 'true',
        auth: process.env.MAIL_USER ? { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS } : undefined,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      });
    }
    return this.transporter;
  }

  /** Fire-and-forget safe: resolves false (and logs) on any failure. */
  async send(to: string | null | undefined, content: MailContent, attachments: MailAttachment[] = []): Promise<boolean> {
    const address = (to ?? '').trim();
    const transport = this.enabled() ? this.transport() : null;
    if (!transport || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return false;
    // Taken before sending: nodemailer rewrites the attachment objects while it works.
    const info = attachments.map((a) => ({ filename: a.filename, bytes: a.content.length, pdf: a.content.subarray(0, 5).toString() === '%PDF-' }));
    try {
      await transport.sendMail({
        from: process.env.MAIL_FROM ?? `Stockily <${process.env.MAIL_USER ?? 'noreply@stockily.ordi-tech.com'}>`,
        to: address,
        subject: content.subject,
        text: content.text,
        html: content.html,
        attachments,
      });
      this.sent.push({ to: address, subject: content.subject, at: new Date(), attachments: info, ...(process.env.MAIL_HOST === 'json' ? { text: content.text } : {}) });
      if (this.sent.length > 50) this.sent.shift();
      return true;
    } catch (err) {
      this.logger.error(`Could not send "${content.subject}" to ${address}: ${err instanceof Error ? err.message : err}`);
      return false;
    }
  }
}
