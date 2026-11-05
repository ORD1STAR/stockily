import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { StringValue } from 'ms';
import { createHash, randomBytes } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { AdminPrismaService } from './admin-prisma.service';

export const ADMIN_TOKEN_TYPE = 'platform-admin';
const ACCESS_TTL = process.env.ADMIN_ACCESS_TTL ?? '30m';
const REFRESH_TTL_DAYS = Number(process.env.ADMIN_REFRESH_TTL_DAYS ?? 7);

export interface AdminTokenPayload {
  sub: string;
  typ: typeof ADMIN_TOKEN_TYPE;
}

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

@Injectable()
export class AdminAuthService {
  constructor(
    private readonly prisma: AdminPrismaService,
    private readonly jwt: JwtService,
  ) {}

  private hash(raw: string) {
    return createHash('sha256').update(raw).digest('hex');
  }

  private async issue(adminId: string) {
    const accessToken = this.jwt.sign({ sub: adminId, typ: ADMIN_TOKEN_TYPE } satisfies AdminTokenPayload, { expiresIn: ACCESS_TTL as StringValue });
    const refreshTokenRaw = randomBytes(32).toString('hex');
    await this.prisma.adminRefreshToken.create({
      data: { adminId, tokenHash: this.hash(refreshTokenRaw), expiresAt: addDays(new Date(), REFRESH_TTL_DAYS) },
    });
    return { accessToken, refreshToken: refreshTokenRaw };
  }

  async login(identifier: string, password: string) {
    const admin = await this.prisma.adminUser.findFirst({
      where: { OR: [{ email: { equals: identifier.trim(), mode: 'insensitive' } }, { username: identifier.trim() }] },
    });
    if (!admin || !admin.isActive || !(await bcrypt.compare(password, admin.passwordHash))) {
      throw new UnauthorizedException('Identifiant ou mot de passe incorrect.');
    }
    await this.prisma.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
    const tokens = await this.issue(admin.id);
    return { admin: { id: admin.id, email: admin.email, name: admin.name }, ...tokens };
  }

  async refresh(refreshTokenRaw: string) {
    const tokenHash = this.hash(refreshTokenRaw);
    const existing = await this.prisma.adminRefreshToken.findFirst({ where: { tokenHash } });
    if (!existing || existing.revokedAt || existing.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Session expirée ou invalide.');
    }
    await this.prisma.adminRefreshToken.update({ where: { id: existing.id }, data: { revokedAt: new Date() } });
    const admin = await this.prisma.adminUser.findUniqueOrThrow({ where: { id: existing.adminId } });
    if (!admin.isActive) throw new UnauthorizedException('Compte désactivé.');
    return this.issue(admin.id);
  }

  async logout(refreshTokenRaw: string) {
    await this.prisma.adminRefreshToken.updateMany({ where: { tokenHash: this.hash(refreshTokenRaw), revokedAt: null }, data: { revokedAt: new Date() } });
  }

  /** Used by the guard to load+verify the admin behind an access token. */
  async verifyAccess(token: string) {
    let payload: AdminTokenPayload;
    try {
      payload = this.jwt.verify<AdminTokenPayload>(token);
    } catch {
      throw new UnauthorizedException("Jeton d'administration invalide ou expiré.");
    }
    if (payload.typ !== ADMIN_TOKEN_TYPE) throw new UnauthorizedException('Jeton invalide.');
    const admin = await this.prisma.adminUser.findUnique({ where: { id: payload.sub } });
    if (!admin || !admin.isActive) throw new UnauthorizedException('Administrateur inconnu ou désactivé.');
    return { id: admin.id, email: admin.email, name: admin.name };
  }
}
