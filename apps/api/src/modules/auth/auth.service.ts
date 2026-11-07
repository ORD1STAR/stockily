import { MailService } from '../mail/mail.service';
import { welcomeMail } from '../mail/mail.templates';
import { ConflictException, Injectable, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { setTenantOnTransaction } from '@org/infra-db';
import { PrismaService } from '../../prisma/prisma.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { OtpChallengeView, OtpService } from './otp.service';

// The 5 Phase 1 modules every new org gets a trial entitlement for at
// signup (docs/Action Plan.md §7/§11) — deliberately not "all 13", since
// Phase 2/3 modules aren't built yet and shouldn't appear usable.
// Multi-sites is NOT in the trial: the first site is free for life and extra sites are paid.
const PHASE1_MODULE_KEYS = ['stock', 'quality', 'invoicing', 'scan'];

// 15-day free trial, no card required — Action Plan §11. A fixed business
// rule, not an environment/deployment concern, so it's a constant rather
// than an env var.
const TRIAL_DAYS = 15;

// bcryptjs (pure JS, no native bindings) over node-native bcrypt/argon2:
// avoids a node-gyp/build-toolchain requirement for local dev on Windows,
// at the cost of being somewhat slower per-hash — an acceptable trade for
// this milestone's auth volume. Revisit if login throughput ever matters.
const SALT_ROUNDS = 10;

const REFRESH_TTL_DAYS = Number(process.env.JWT_REFRESH_TTL_DAYS ?? 30);

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly mail: MailService,
    private readonly otp: OtpService,
  ) {}

  async signup(dto: SignupDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing && !(this.otp.active() && !existing.emailVerifiedAt)) throw new ConflictException('Cet email est déjà utilisé.');
    // An earlier signup with this address that was never confirmed does not own it:
    // the person now proving they can read the mailbox takes the account over.
    if (existing) return this.restartUnverifiedSignup(existing, dto);

    const superAdminRole = await this.prisma.role.findFirst({ where: { name: 'Super Admin', isSystem: true } });
    if (!superAdminRole) {
      throw new InternalServerErrorException('Les rôles système ne sont pas initialisés, exécutez `npm run db:seed` d\'abord.');
    }

    const phase1Modules = await this.prisma.module.findMany({ where: { key: { in: PHASE1_MODULE_KEYS } } });
    if (phase1Modules.length !== PHASE1_MODULE_KEYS.length) {
      throw new InternalServerErrorException('Les modules ne sont pas initialisés, exécutez `npm run db:seed` d\'abord.');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const trialEndsAt = addDays(new Date(), TRIAL_DAYS);

    const { organization, user } = await this.prisma.$transaction(async (tx) => {
      // Milestone 8 (RLS) — the org's id is generated here, in app code,
      // specifically so tenant context can be set *before* the row exists
      // rather than after: `organizations`' own SELECT policy scopes to
      // `id = current_setting('app.tenant_id')`, and Prisma's `.create()`
      // always does `INSERT ... RETURNING` under the hood — which Postgres
      // evaluates against that SAME SELECT policy for the just-inserted
      // row (verified empirically — an `INSERT ... RETURNING` with no
      // tenant context set yet was rejected even though the INSERT policy
      // itself is unconditional). Every following statement in this
      // transaction inserts rows scoped to this org, so the tenant context
      // has to be set explicitly regardless — the RLS extension only
      // auto-wraps *root-level* calls, never ones already inside an
      // interactive transaction (see rls-extension.ts's doc for why).
      const organizationId = randomUUID();
      await setTenantOnTransaction(tx, organizationId);
      const organization = await tx.organization.create({
        data: { id: organizationId, name: dto.organizationName, plan: 'trial' },
      });
      const user = await tx.user.create({ data: { orgId: organization.id, email: dto.email, passwordHash } });
      // Org-wide (siteId: null) — the first user is always Super Admin for
      // their own organization (docs/Action Plan.md §2).
      await tx.userRole.create({ data: { userId: user.id, roleId: superAdminRole.id, siteId: null } });
      await tx.organizationModuleEntitlement.createMany({
        data: phase1Modules.map((m) => ({ orgId: organization.id, moduleId: m.id, status: 'trial', trialEndsAt })),
      });
      // Every new org starts with one site, so Stock/Sites etc. have
      // somewhere to attach to without a manual setup step.
      await tx.site.create({ data: { orgId: organization.id, name: 'Site #1' } });
      return { organization, user };
    });

    if (this.otp.active() && user.email) {
      // The ids ride along only so the audit log can record the creation (AuditInterceptor reads them); they are random UUIDs.
      const challenge = await this.otp.issue({ id: user.id, email: user.email }, 'verify_email');
      return { ...challenge, organization: { id: organization.id }, user: { id: user.id } };
    }

    // No mail delivery configured (local dev, offline app): the account is usable at once.
    void this.mail.send(user.email, welcomeMail({ organizationName: organization.name, trialDays: TRIAL_DAYS }));
    const tokens = await this.issueTokens(user.id, organization.id);
    return {
      organization: { id: organization.id, name: organization.name },
      user: { id: user.id, email: user.email },
      ...tokens,
    };
  }

  /** Same address signs up again before confirming it: refresh the password/company and send a new code. */
  private async restartUnverifiedSignup(existing: { id: string; orgId: string; email: string | null }, dto: SignupDto) {
    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    await this.prisma.$transaction(async (tx) => {
      await setTenantOnTransaction(tx, existing.orgId);
      await tx.user.update({ where: { id: existing.id }, data: { passwordHash } });
      await tx.organization.update({ where: { id: existing.orgId }, data: { name: dto.organizationName } });
    });
    return this.otp.issue({ id: existing.id, email: existing.email as string }, 'verify_email');
  }

  async login(dto: LoginDto) {
    const identifier = (dto.identifier ?? dto.email ?? '').trim();
    // Email or username, resolved in one lookup. The users_select RLS policy
    // has an "unset tenant context" carve-out (login is unauthenticated), so
    // this findFirst sees all orgs' users — both columns are globally unique,
    // so it still matches at most one. Lowercased so a case difference in the
    // typed identifier doesn't block a real account.
    const user = identifier
      ? await this.prisma.user.findFirst({
          where: { OR: [{ email: { equals: identifier, mode: 'insensitive' } }, { username: identifier }] },
        })
      : null;
    // Deliberately identical error for "no such user", "wrong password" and
    // "deactivated" — distinguishing them lets an attacker enumerate accounts.
    if (!user || !user.isActive || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Identifiant ou mot de passe incorrect.');
    }

    // Self-heals orgs that predate the signup-time site creation above (or
    // whose only site got deleted) — login is the one path every active
    // account reliably passes through. Like signup, this runs with no
    // tenant context yet (unauthenticated endpoint), so RLS-scoped access
    // needs its own explicit transaction — see rls-extension.ts.
    await this.prisma.$transaction(async (tx) => {
      await setTenantOnTransaction(tx, user.orgId);
      const siteCount = await tx.site.count({ where: { orgId: user.orgId } });
      if (siteCount === 0) {
        await tx.site.create({ data: { orgId: user.orgId, name: 'Site #1' } });
      }
    });

    // Password is right; now the mailbox checks. Only users with an email (sub-users
    // log in by username and have none) and only where codes can be delivered.
    if (this.otp.active() && user.email) {
      if (!user.emailVerifiedAt) return this.otp.issue({ id: user.id, email: user.email }, 'verify_email');
      if (user.twoFactorEnabled) return this.otp.issue({ id: user.id, email: user.email }, 'login');
    }

    const tokens = await this.issueTokens(user.id, user.orgId);
    return { user: { id: user.id, email: user.email }, ...tokens };
  }

  /** Second step of signup/login: the emailed code turns into a session. */
  async verifyOtp(challengeId: string, code: string) {
    const { userId, purpose } = await this.otp.verify(challengeId, code);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) throw new UnauthorizedException('Ce compte est désactivé.');
    // Unauthenticated call: the organization row is only visible with its tenant context set (RLS).
    const firstVerification = purpose === 'verify_email' && !user.emailVerifiedAt;
    const organization = await this.prisma.$transaction(async (tx) => {
      await setTenantOnTransaction(tx, user.orgId);
      if (firstVerification) await tx.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
      return tx.organization.findUniqueOrThrow({ where: { id: user.orgId }, select: { id: true, name: true } });
    });
    if (firstVerification) void this.mail.send(user.email, welcomeMail({ organizationName: organization.name, trialDays: TRIAL_DAYS }));
    const tokens = await this.issueTokens(user.id, user.orgId);
    return { organization, user: { id: user.id, email: user.email }, ...tokens };
  }

  resendOtp(challengeId: string): Promise<OtpChallengeView> {
    return this.otp.resend(challengeId);
  }

  async refresh(refreshTokenRaw: string) {
    const tokenHash = this.hashToken(refreshTokenRaw);
    const existing = await this.prisma.refreshToken.findFirst({ where: { tokenHash } });

    if (!existing || existing.revokedAt || existing.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Session expirée ou invalide.');
    }

    // Rotate: the presented token is revoked immediately, so it can never
    // be replayed even if it leaks after this point — this IS the
    // logout-everywhere mechanism's counterpart (docs/Action Plan.md §4).
    await this.prisma.refreshToken.update({ where: { id: existing.id }, data: { revokedAt: new Date() } });

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: existing.userId } });
    return this.issueTokens(user.id, user.orgId);
  }

  // Single-session logout. Deliberately silent on a token that doesn't
  // exist or is already revoked (idempotent, and doesn't let a caller
  // probe whether a given token string was ever valid).
  async logout(refreshTokenRaw: string): Promise<void> {
    const tokenHash = this.hashToken(refreshTokenRaw);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // Logout-everywhere: revokes every live refresh token for this user, not
  // just the one presented. The user themself invokes this authenticated
  // as who they are (docs/Action Plan.md §4), not by token value.
  async logoutEverywhere(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokens(userId: string, orgId: string) {
    const accessToken = this.jwtService.sign({ sub: userId, orgId });

    const refreshTokenRaw = randomBytes(32).toString('hex');
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(refreshTokenRaw),
        expiresAt: addDays(new Date(), REFRESH_TTL_DAYS),
      },
    });

    return { accessToken, refreshToken: refreshTokenRaw };
  }

  // Refresh tokens are high-entropy random bytes, not user-chosen secrets
  // — a fast cryptographic hash is appropriate here, unlike passwords
  // (which use bcrypt's deliberately slow KDF above).
  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }
}
