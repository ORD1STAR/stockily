import * as bcrypt from 'bcryptjs';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AdminPrismaService } from './admin-prisma.service';
import { MembersService } from '../modules/members/members.service';

export const ADMIN_MEMBERS = 'ADMIN_MEMBERS_SERVICE';

const now = () => new Date();
const isValid = (status: string, trialEndsAt: Date | null, expiresAt: Date | null = null) =>
  (status === 'active' && (!expiresAt || expiresAt.getTime() > Date.now())) || (status === 'trial' && !!trialEndsAt && trialEndsAt.getTime() > Date.now());

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: AdminPrismaService,
    // A MembersService bound to the superuser client, so sub-user management
    // works cross-tenant (reusing the exact org-side logic).
    @Inject(ADMIN_MEMBERS) private readonly members: MembersService,
  ) {}

  async dashboard() {
    const [orgCount, byPlan, userCount, activeDevices, entitlements, recentOrgs, moduleCatalog, newSuggestions] = await Promise.all([
      this.prisma.organization.count(),
      this.prisma.organization.groupBy({ by: ['plan'], _count: true }),
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.deviceActivation.count({ where: { status: 'active' } }),
      this.prisma.organizationModuleEntitlement.findMany({ select: { moduleId: true, status: true, trialEndsAt: true, expiresAt: true } }),
      this.prisma.organization.findMany({ orderBy: { createdAt: 'desc' }, take: 8, select: { id: true, name: true, plan: true, createdAt: true } }),
      this.prisma.module.findMany({ select: { id: true, key: true, name: true } }),
      this.prisma.featureSuggestion.count({ where: { status: 'new' } }),
    ]);
    const keyById = new Map(moduleCatalog.map((m) => [m.id, m]));
    const adoption = new Map<string, number>();
    for (const e of entitlements) {
      if (!isValid(e.status, e.trialEndsAt, e.expiresAt)) continue;
      const m = keyById.get(e.moduleId);
      if (m) adoption.set(m.key, (adoption.get(m.key) ?? 0) + 1);
    }
    return {
      organizations: orgCount,
      byPlan: byPlan.map((p) => ({ plan: p.plan, count: p._count })),
      activeUsers: userCount,
      activeDevices,
      moduleAdoption: moduleCatalog
        .map((m) => ({ key: m.key, name: m.name, orgs: adoption.get(m.key) ?? 0 }))
        .sort((a, b) => b.orgs - a.orgs),
      recentOrganizations: recentOrgs,
      newSuggestions,
    };
  }

  async listOrganizations(search?: string) {
    const orgs = await this.prisma.organization.findMany({
      where: search ? { name: { contains: search, mode: 'insensitive' } } : undefined,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        plan: true,
        createdAt: true,
        seatsPerSite: true,
        _count: { select: { users: true, sites: true } },
      },
    });
    const ids = orgs.map((o) => o.id);
    const [devices, ents] = await Promise.all([
      this.prisma.deviceActivation.groupBy({ by: ['orgId'], where: { orgId: { in: ids }, status: 'active' }, _count: true }),
      this.prisma.organizationModuleEntitlement.findMany({ where: { orgId: { in: ids } }, select: { orgId: true, status: true, trialEndsAt: true, expiresAt: true } }),
    ]);
    const deviceCount = new Map(devices.map((d) => [d.orgId, d._count]));
    const activeModules = new Map<string, number>();
    for (const e of ents) if (isValid(e.status, e.trialEndsAt, e.expiresAt)) activeModules.set(e.orgId, (activeModules.get(e.orgId) ?? 0) + 1);
    return orgs.map((o) => ({
      id: o.id,
      name: o.name,
      plan: o.plan,
      createdAt: o.createdAt,
      seatsPerSite: o.seatsPerSite,
      users: o._count.users,
      sites: o._count.sites,
      activeDevices: deviceCount.get(o.id) ?? 0,
      activeModules: activeModules.get(o.id) ?? 0,
    }));
  }

  async organizationDetail(orgId: string) {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new NotFoundException('Organisation introuvable.');
    const [modules, ents, sites, devices, users] = await Promise.all([
      this.prisma.module.findMany({ orderBy: { phase: 'asc' }, select: { id: true, key: true, name: true, phase: true, dependencies: true } }),
      this.prisma.organizationModuleEntitlement.findMany({ where: { orgId } }),
      this.prisma.site.findMany({ where: { orgId }, select: { id: true, name: true, isActive: true } }),
      this.prisma.deviceActivation.findMany({ where: { orgId }, orderBy: { lastRenewedAt: 'desc' } }),
      this.members.list(orgId),
    ]);
    const entByModule = new Map(ents.map((e) => [e.moduleId, e]));
    const activeSites = sites.filter((s) => s.isActive).length;
    return {
      organization: {
        id: org.id,
        name: org.name,
        plan: org.plan,
        email: org.email,
        phone: org.phone,
        address: org.address,
        nif: org.nif,
        createdAt: org.createdAt,
        seatsPerSite: org.seatsPerSite,
      },
      seats: { used: devices.filter((d) => d.status === 'active').length, total: Math.max(1, activeSites) * org.seatsPerSite },
      modules: modules
        .filter((m) => m.phase > 0) // hide infra modules (licensing/members)
        .map((m) => {
          const e = entByModule.get(m.id);
          return {
            key: m.key,
            name: m.name,
            phase: m.phase,
            dependencies: m.dependencies,
            status: e?.status ?? 'none',
            trialEndsAt: e?.trialEndsAt ?? null,
            expiresAt: e?.expiresAt ?? null,
            active: e ? isValid(e.status, e.trialEndsAt, e.expiresAt) : false,
          };
        }),
      sites,
      devices,
      users,
    };
  }

  private async moduleByKey(key: string) {
    const module = await this.prisma.module.findUnique({ where: { key } });
    if (!module) throw new NotFoundException(`Module inconnu : ${key}`);
    if (module.phase === 0) throw new BadRequestException('Ce module interne ne se gère pas ici.');
    return module;
  }

  /** Activate (grant) a module for an org. Enforces the module's dependencies unless forced. */
  async setModule(orgId: string, key: string, action: 'activate' | 'suspend' | 'cancel', force = false) {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new NotFoundException('Organisation introuvable.');
    const module = await this.moduleByKey(key);

    if (action === 'activate' && module.dependencies.length > 0 && !force) {
      const ents = await this.prisma.organizationModuleEntitlement.findMany({ where: { orgId }, select: { moduleId: true, status: true, trialEndsAt: true, expiresAt: true } });
      const activeIds = new Set(ents.filter((e) => isValid(e.status, e.trialEndsAt, e.expiresAt)).map((e) => e.moduleId));
      const deps = await this.prisma.module.findMany({ where: { key: { in: module.dependencies } } });
      const missing = deps.filter((d) => !activeIds.has(d.id)).map((d) => d.name);
      if (missing.length > 0) {
        throw new BadRequestException({
          statusCode: 400,
          error: 'missing_dependencies',
          missing,
          message: `Ce module dépend de : ${missing.join(', ')}. Activez-les d'abord, ou forcez l'activation.`,
        });
      }
    }

    const status = action === 'activate' ? 'active' : action === 'suspend' ? 'suspended' : 'cancelled';
    const row = await this.prisma.organizationModuleEntitlement.upsert({
      where: { orgId_moduleId: { orgId, moduleId: module.id } },
      create: { orgId, moduleId: module.id, status, trialEndsAt: null, activatedAt: now() },
      // An admin grant has no end date (expiresAt null) — unlike a self-service purchase.
      update: { status, trialEndsAt: null, ...(action === 'activate' ? { expiresAt: null } : {}) },
    });
    return { key, status: row.status };
  }

  async setSeatsPerSite(orgId: string, seatsPerSite: number) {
    if (seatsPerSite < 1 || seatsPerSite > 50) throw new BadRequestException('Nombre de postes par site invalide (1–50).');
    await this.prisma.organization.update({ where: { id: orgId }, data: { seatsPerSite } });
    return { seatsPerSite };
  }

  // ───────── Devices ─────────
  async setDevice(deviceId: string, action: 'deactivate' | 'revoke') {
    const device = await this.prisma.deviceActivation.findUnique({ where: { id: deviceId } });
    if (!device) throw new NotFoundException('Appareil introuvable.');
    const status = action === 'revoke' ? 'revoked' : 'deactivated';
    await this.prisma.$transaction([
      this.prisma.deviceActivation.update({ where: { id: deviceId }, data: { status, deactivatedAt: now() } }),
      this.prisma.numberBlock.updateMany({ where: { deviceActivationId: deviceId, releasedAt: null }, data: { releasedAt: now() } }),
    ]);
    return { id: deviceId, status };
  }

  // ───────── Users (cross-tenant, via the admin-bound MembersService) ─────────
  listUsers(orgId: string) {
    return this.members.list(orgId);
  }
  grantableModules() {
    return this.members.grantableModules();
  }
  createUser(orgId: string, adminId: string, dto: Parameters<MembersService['create']>[2]) {
    return this.members.create(orgId, adminId, dto);
  }
  updateUser(orgId: string, adminId: string, userId: string, dto: Parameters<MembersService['update']>[3]) {
    return this.members.update(orgId, adminId, userId, dto);
  }

  /** Edits any user's account (owners too). No password policy on the admin side. */
  async updateUserAccount(
    orgId: string,
    userId: string,
    dto: { displayName?: string; username?: string; email?: string; password?: string; isActive?: boolean },
  ) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, orgId } });
    if (!user) throw new NotFoundException('Utilisateur introuvable.');
    const data: Record<string, unknown> = {};
    if (dto.displayName !== undefined) data.displayName = dto.displayName.trim() || null;
    if (dto.username !== undefined) data.username = dto.username.trim() || null;
    if (dto.email !== undefined) data.email = dto.email.trim().toLowerCase() || null;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.password) data.passwordHash = await bcrypt.hash(dto.password, 10);
    if (data.username && data.username !== user.username) {
      if (await this.prisma.user.findFirst({ where: { username: data.username as string, NOT: { id: userId } } })) throw new ConflictException("Ce nom d'utilisateur est déjà pris.");
    }
    if (data.email && data.email !== user.email) {
      if (await this.prisma.user.findFirst({ where: { email: data.email as string, NOT: { id: userId } } })) throw new ConflictException('Cet email est déjà utilisé.');
    }
    if (!(data.email ?? user.email) && !(data.username ?? user.username)) throw new BadRequestException("Il faut au moins un email ou un nom d'utilisateur.");
    await this.prisma.user.update({ where: { id: userId }, data });
    if (dto.password || dto.isActive === false) {
      await this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    return { ok: true };
  }

  // ───────── Pricing ─────────
  async listPricing() {
    const [modules, prices] = await Promise.all([
      this.prisma.module.findMany({ where: { phase: { gt: 0 } }, orderBy: { phase: 'asc' }, select: { key: true, name: true } }),
      this.prisma.modulePrice.findMany(),
    ]);
    const byKey = new Map(prices.map((p) => [p.moduleKey, p]));
    return modules.map((m) => {
      const p = byKey.get(m.key);
      return { moduleKey: m.key, name: m.name, monthlyPrice: p ? Number(p.monthlyPrice) : null, currency: p?.currency ?? 'DZD', isActive: p?.isActive ?? true };
    });
  }

  async setPrice(moduleKey: string, monthlyPrice: number, isActive: boolean) {
    await this.moduleByKey(moduleKey);
    const row = await this.prisma.modulePrice.upsert({
      where: { moduleKey },
      create: { moduleKey, monthlyPrice, isActive },
      update: { monthlyPrice, isActive },
    });
    return { moduleKey, monthlyPrice: Number(row.monthlyPrice), currency: row.currency, isActive: row.isActive };
  }

  // ───────── Payments ─────────
  async listSuggestions() {
    const rows = await this.prisma.featureSuggestion.findMany({ orderBy: { createdAt: 'desc' }, take: 500 });
    return rows;
  }

  async updateSuggestion(id: string, data: { status?: string; adminNote?: string }) {
    const exists = await this.prisma.featureSuggestion.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException('Proposition introuvable.');
    return this.prisma.featureSuggestion.update({ where: { id }, data: { ...(data.status ? { status: data.status } : {}), ...(data.adminNote !== undefined ? { adminNote: data.adminNote || null } : {}) } });
  }

  async deleteSuggestion(id: string) {
    const res = await this.prisma.featureSuggestion.deleteMany({ where: { id } });
    if (res.count === 0) throw new NotFoundException('Proposition introuvable.');
    return { ok: true };
  }

  async listPayments() {
    const payments = await this.prisma.platformPayment.findMany({ orderBy: { createdAt: 'desc' }, take: 500 });
    const orgIds = [...new Set(payments.map((p) => p.orgId))];
    const orgs = await this.prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } });
    const name = new Map(orgs.map((o) => [o.id, o.name]));
    return payments.map((p) => ({
      id: p.id,
      org: name.get(p.orgId) ?? p.orgId,
      amount: Number(p.amount),
      currency: p.currency,
      method: p.method,
      status: p.status,
      reference: p.reference ?? p.number,
      checkoutId: p.checkoutId,
      trackId: p.trackId,
      kind: p.kind,
      paidAt: p.paidAt,
      createdAt: p.createdAt,
    }));
  }

  // ───────── System logs ─────────
  async logs(limit = 200) {
    const [tenant, adminLogs, orgs] = await Promise.all([
      this.prisma.auditLog.findMany({ orderBy: { occurredAt: 'desc' }, take: limit }),
      this.prisma.adminAuditLog.findMany({ orderBy: { occurredAt: 'desc' }, take: limit }),
      this.prisma.organization.findMany({ select: { id: true, name: true } }),
    ]);
    const orgName = new Map(orgs.map((o) => [o.id, o.name]));
    // Resolve tenant actor ids to a human handle (email / username / name).
    const actorIds = [...new Set(tenant.map((l) => l.actorId).filter((x): x is string => !!x))];
    const actors = actorIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, email: true, username: true, displayName: true } })
      : [];
    const actorName = new Map(actors.map((u) => [u.id, u.displayName ?? u.email ?? (u.username ? `@${u.username}` : u.id.slice(0, 8))]));

    const merged = [
      ...tenant.map((l) => ({
        kind: 'tenant' as const,
        at: l.occurredAt,
        org: orgName.get(l.orgId) ?? l.orgId,
        actor: l.actorId ? actorName.get(l.actorId) ?? l.actorId.slice(0, 8) : 'Système',
        action: l.action,
        entityType: l.entityType,
        entityId: l.entityId,
        detail: (l.diff ?? null) as unknown,
      })),
      ...adminLogs.map((l) => ({
        kind: 'admin' as const,
        at: l.occurredAt,
        org: '—',
        actor: l.adminEmail,
        action: l.action,
        entityType: null as string | null,
        entityId: null as string | null,
        detail: (l.detail ?? null) as unknown,
      })),
    ].sort((a, b) => b.at.getTime() - a.at.getTime());
    return merged.slice(0, limit);
  }

  // ───────── Database schema (for the SQL console explorer) ─────────
  async schema() {
    const rows = await this.prisma.$queryRaw<{ table_name: string; column_name: string; data_type: string; is_nullable: string }[]>`
      SELECT c.table_name, c.column_name, c.data_type, c.is_nullable
      FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
      WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND c.table_name NOT LIKE '\\_prisma%'
      ORDER BY c.table_name, c.ordinal_position`;
    const map = new Map<string, { name: string; type: string; nullable: boolean }[]>();
    for (const r of rows) {
      if (!map.has(r.table_name)) map.set(r.table_name, []);
      map.get(r.table_name)!.push({ name: r.column_name, type: r.data_type, nullable: r.is_nullable === 'YES' });
    }
    return [...map.entries()].map(([table, columns]) => ({ table, columns }));
  }
}
