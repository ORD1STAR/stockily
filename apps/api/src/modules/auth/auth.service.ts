import { ConflictException, Injectable, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';

// The 5 Phase 1 modules every new org gets a trial entitlement for at
// signup (docs/Action Plan.md §7/§11) — deliberately not "all 13", since
// Phase 2/3 modules aren't built yet and shouldn't appear usable.
const PHASE1_MODULE_KEYS = ['stock', 'quality', 'invoicing', 'sites', 'scan'];

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
  ) {}

  async signup(dto: SignupDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already in use');

    const superAdminRole = await this.prisma.role.findFirst({ where: { name: 'Super Admin', isSystem: true } });
    if (!superAdminRole) {
      throw new InternalServerErrorException('System roles are not seeded — run `npm run db:seed` first.');
    }

    const phase1Modules = await this.prisma.module.findMany({ where: { key: { in: PHASE1_MODULE_KEYS } } });
    if (phase1Modules.length !== PHASE1_MODULE_KEYS.length) {
      throw new InternalServerErrorException('Modules are not seeded — run `npm run db:seed` first.');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const trialEndsAt = addDays(new Date(), TRIAL_DAYS);

    const { organization, user } = await this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({ data: { name: dto.organizationName, plan: 'trial' } });
      const user = await tx.user.create({ data: { orgId: organization.id, email: dto.email, passwordHash } });
      // Org-wide (siteId: null) — the first user is always Super Admin for
      // their own organization (docs/Action Plan.md §2).
      await tx.userRole.create({ data: { userId: user.id, roleId: superAdminRole.id, siteId: null } });
      await tx.organizationModuleEntitlement.createMany({
        data: phase1Modules.map((m) => ({ orgId: organization.id, moduleId: m.id, status: 'trial', trialEndsAt })),
      });
      return { organization, user };
    });

    const tokens = await this.issueTokens(user.id, organization.id);
    return {
      organization: { id: organization.id, name: organization.name },
      user: { id: user.id, email: user.email },
      ...tokens,
    };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    // Deliberately identical error for "no such user" and "wrong password"
    // — distinguishing them lets an attacker enumerate valid emails.
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const tokens = await this.issueTokens(user.id, user.orgId);
    return { user: { id: user.id, email: user.email }, ...tokens };
  }

  async refresh(refreshTokenRaw: string) {
    const tokenHash = this.hashToken(refreshTokenRaw);
    const existing = await this.prisma.refreshToken.findFirst({ where: { tokenHash } });

    if (!existing || existing.revokedAt || existing.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
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
