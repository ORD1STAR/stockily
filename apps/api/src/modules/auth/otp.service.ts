import { BadRequestException, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { otpMail } from '../mail/mail.templates';

export type OtpPurpose = 'verify_email' | 'login';

export const OTP_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5; // wrong codes before the challenge dies
const MAX_SENDS = 5; // codes (first + re-sends) per challenge
const RESEND_COOLDOWN_S = 30;

export interface OtpChallengeView {
  otpRequired: true;
  challengeId: string;
  purpose: OtpPurpose;
  /** Masked (j***@gmail.com): confirms where the code went without leaking the address. */
  email: string;
  resendIn: number;
}

export function maskEmail(email: string): string {
  const [name, domain] = email.split('@');
  return `${name.slice(0, 1)}${'*'.repeat(Math.max(2, Math.min(name.length - 1, 5)))}@${domain}`;
}

/**
 * Email one-time codes (mailbox verification at signup, second factor at login).
 * Only an HMAC of the code is stored; codes are single-use, expire after
 * OTP_TTL_MINUTES, tolerate MAX_ATTEMPTS wrong tries and MAX_SENDS emails.
 */
@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  /** True when codes can actually be delivered: server mode with mail configured. The offline desktop app never uses them. */
  active(): boolean {
    return process.env.STOCKILY_LOCAL_MODE !== '1' && this.mail.enabled();
  }

  private hash(challengeId: string, code: string): string {
    const secret = process.env.JWT_SECRET ?? 'stockily-dev-secret';
    return createHmac('sha256', secret).update(`otp:${challengeId}:${code}`).digest('hex');
  }

  private newCode(): string {
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
  }

  /** Creates a challenge for the user and emails the code. Any earlier open challenge of the same kind is cancelled. */
  async issue(user: { id: string; email: string }, purpose: OtpPurpose): Promise<OtpChallengeView> {
    await this.prisma.authChallenge.updateMany({ where: { userId: user.id, purpose, consumedAt: null }, data: { consumedAt: new Date() } });
    const code = this.newCode();
    const row = await this.prisma.authChallenge.create({
      data: { userId: user.id, purpose, codeHash: 'pending', expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60_000) },
    });
    await this.prisma.authChallenge.update({ where: { id: row.id }, data: { codeHash: this.hash(row.id, code) } });
    await this.mail.send(user.email, otpMail({ code, purpose, minutes: OTP_TTL_MINUTES }));
    return { otpRequired: true, challengeId: row.id, purpose, email: maskEmail(user.email), resendIn: RESEND_COOLDOWN_S };
  }

  /** Checks the code; on success the challenge is consumed and the user id + purpose returned. */
  async verify(challengeId: string, code: string): Promise<{ userId: string; purpose: OtpPurpose }> {
    const c = await this.prisma.authChallenge.findUnique({ where: { id: challengeId } });
    if (!c || c.consumedAt) throw new UnauthorizedException('Ce code n’est plus valide. Recommencez.');
    if (c.expiresAt.getTime() < Date.now()) throw new UnauthorizedException('Ce code a expiré. Demandez-en un nouveau.');
    if (c.attempts >= MAX_ATTEMPTS) throw new UnauthorizedException('Trop d’essais. Recommencez la connexion.');

    const given = Buffer.from(this.hash(c.id, code.trim()));
    const real = Buffer.from(c.codeHash);
    if (given.length !== real.length || !timingSafeEqual(given, real)) {
      const attempts = c.attempts + 1;
      await this.prisma.authChallenge.update({ where: { id: c.id }, data: { attempts, ...(attempts >= MAX_ATTEMPTS ? { consumedAt: new Date() } : {}) } });
      throw new UnauthorizedException(attempts >= MAX_ATTEMPTS ? 'Trop d’essais. Recommencez la connexion.' : `Code incorrect. Il vous reste ${MAX_ATTEMPTS - attempts} essai(s).`);
    }
    // Single use: the update only succeeds for the request that flips consumedAt first.
    const won = await this.prisma.authChallenge.updateMany({ where: { id: c.id, consumedAt: null }, data: { consumedAt: new Date() } });
    if (won.count !== 1) throw new UnauthorizedException('Ce code n’est plus valide. Recommencez.');
    return { userId: c.userId, purpose: c.purpose as OtpPurpose };
  }

  /** New code for the same challenge, with a cooldown and a cap. */
  async resend(challengeId: string): Promise<OtpChallengeView> {
    const c = await this.prisma.authChallenge.findUnique({ where: { id: challengeId }, include: { user: { select: { email: true } } } });
    if (!c || c.consumedAt || !c.user.email) throw new UnauthorizedException('Ce code n’est plus valide. Recommencez.');
    const wait = RESEND_COOLDOWN_S - Math.floor((Date.now() - c.lastSentAt.getTime()) / 1000);
    if (wait > 0) throw new HttpException(`Patientez ${wait} s avant de demander un nouveau code.`, HttpStatus.TOO_MANY_REQUESTS);
    if (c.sendCount >= MAX_SENDS) throw new BadRequestException('Trop de codes demandés. Recommencez la connexion.');
    const code = this.newCode();
    await this.prisma.authChallenge.update({
      where: { id: c.id },
      data: { codeHash: this.hash(c.id, code), attempts: 0, sendCount: c.sendCount + 1, lastSentAt: new Date(), expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60_000) },
    });
    await this.mail.send(c.user.email, otpMail({ code, purpose: c.purpose as OtpPurpose, minutes: OTP_TTL_MINUTES }));
    return { otpRequired: true, challengeId: c.id, purpose: c.purpose as OtpPurpose, email: maskEmail(c.user.email), resendIn: RESEND_COOLDOWN_S };
  }
}
