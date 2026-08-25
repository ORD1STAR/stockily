// No SMTP/email provider is configured anywhere in this project (checked —
// no credentials, no provider client, nothing). Rather than invent one with
// fabricated credentials, this is a clearly-named extension point: swap
// NoOpEmailSender for a real implementation (SES, SendGrid, Postmark, ...)
// once the user picks a provider. Same pattern as Quarantine/Audit's own
// documented extension points in earlier milestones.
export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface EmailSenderPort {
  send(to: string, subject: string, body: string, attachments?: EmailAttachment[]): Promise<void>;
}

export const EMAIL_SENDER = Symbol('EMAIL_SENDER');
