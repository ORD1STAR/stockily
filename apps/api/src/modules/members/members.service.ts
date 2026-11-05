import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { setTenantOnTransaction } from '@org/infra-db';
import { PrismaService } from '../../prisma/prisma.service';
import { CAPABILITIES } from './capabilities';
import { AccessDto, CreateMemberDto, UpdateMemberDto } from './members.dto';

const SALT_ROUNDS = 10;

// System roles that mean "full access" — these users aren't editable sub-users.
const ADMIN_ROLE_NAMES = ['Super Admin', 'Gestionnaire'];
// Infra modules a sub-user can never be granted (admin powers).
// Reference-data reads every page needs besides its own module's permissions
// (site pickers, product lookups, partner lists). Granted automatically with
// any module so pages don't fail with "Permission manquante".
export const IMPLIED_READS: Record<string, string[]> = {
  stock: ['sites.site.read'],
  scan: ['sites.site.read', 'stock.product.read'],
  sites: ['stock.product.read'],
  purchasing: ['sites.site.read', 'stock.product.read', 'invoicing.partner.read'],
  sales: ['sites.site.read', 'stock.product.read', 'invoicing.partner.read'],
  invoicing: ['stock.product.read', 'sites.site.read'],
  cash: ['invoicing.partner.read'],
  quality: ['stock.product.read', 'sites.site.read'],
  stats: ['sites.site.read'],
};
const IMPLIED_SET = new Set(Object.values(IMPLIED_READS).flat());
const NON_GRANTABLE = new Set(['members', 'licensing']);

type Tx = Prisma.TransactionClient;

export interface MemberView {
  id: string;
  email: string | null;
  username: string | null;
  displayName: string | null;
  isActive: boolean;
  isAdmin: boolean;
  roleName: string | null;
  access: { modules: { key: string; level: 'view' | 'edit' | 'custom'; actions: string[] }[]; sites: 'all' | { id: string; name: string }[] } | null;
}

@Injectable()
export class MembersService {
  constructor(private readonly prisma: PrismaService) {}

  private memberRoleName(userId: string) {
    return `member:${userId}`;
  }

  /** id<->key maps for modules (RolePermission has only moduleId, no relation). */
  private async moduleMaps() {
    const modules = await this.prisma.module.findMany({ select: { id: true, key: true, name: true } });
    return {
      idToKey: new Map(modules.map((m) => [m.id, m.key])),
      keyToModule: new Map(modules.map((m) => [m.key, m])),
    };
  }

  /** moduleKey -> every action / the read-only subset, read from the Super Admin system role (which holds the full catalog). */
  private async catalog(): Promise<Map<string, { name: string; actions: string[]; readActions: string[] }>> {
    const superAdmin = await this.prisma.role.findFirst({ where: { name: 'Super Admin', isSystem: true } });
    if (!superAdmin) throw new BadRequestException('Rôles système non initialisés.');
    const { idToKey, keyToModule } = await this.moduleMaps();
    const perms = await this.prisma.rolePermission.findMany({ where: { roleId: superAdmin.id }, select: { moduleId: true, action: true } });
    const map = new Map<string, { name: string; actions: string[]; readActions: string[] }>();
    for (const p of perms) {
      const key = idToKey.get(p.moduleId);
      if (!key || NON_GRANTABLE.has(key)) continue;
      const e = map.get(key) ?? { name: keyToModule.get(key)?.name ?? key, actions: [], readActions: [] };
      e.actions.push(p.action);
      if (p.action.endsWith('.read')) e.readActions.push(p.action);
      map.set(key, e);
    }
    // "Profil entreprise" (logo, NIF, RC…) is granted on its own — none / view / edit —
    // so its actions are split out of the invoicing module into a pseudo-module.
    const inv = map.get('invoicing');
    if (inv) {
      const profile = inv.actions.filter((a) => a.startsWith('invoicing.profile.'));
      inv.actions = inv.actions.filter((a) => !profile.includes(a));
      inv.readActions = inv.readActions.filter((a) => !profile.includes(a));
      if (profile.length) map.set('business', { name: 'Profil entreprise', actions: profile, readActions: profile.filter((a) => a.endsWith('.read')) });
    }
    return map;
  }

  /** The modules + levels a sub-user can be granted (for the create/edit form). */
  async grantableModules() {
    const cat = await this.catalog();
    return [...cat.entries()].map(([key, v]) => ({ key, name: v.name, hasReadOnly: v.readActions.length > 0, capabilities: CAPABILITIES[key] ?? [] }));
  }

  private async actionsFor(access: AccessDto): Promise<{ moduleId: string; action: string }[]> {
    const cat = await this.catalog();
    const { idToKey } = await this.moduleMaps();
    const keyToId = new Map([...idToKey.entries()].map(([id, k]) => [k, id]));
    const rows: { moduleId: string; action: string }[] = [];
    const add = (action: string) => {
      const moduleId = keyToId.get(action.split('.')[0]);
      if (!moduleId) throw new BadRequestException(`Action inconnue : ${action}`);
      if (!rows.some((r) => r.moduleId === moduleId && r.action === action)) rows.push({ moduleId, action });
    };
    for (const m of access.modules) {
      const entry = cat.get(m.key);
      if (!entry) throw new BadRequestException(`Module non attribuable : ${m.key}`);
      if (m.level === 'custom') {
        // Consultation is always included; chosen actions must be real capabilities of this module.
        const allowed = new Set((CAPABILITIES[m.key] ?? []).flatMap((c) => c.actions));
        for (const a of entry.readActions) add(a);
        for (const a of m.actions ?? []) {
          if (!allowed.has(a)) throw new BadRequestException(`Permission non attribuable : ${a}`);
          add(a);
        }
      } else {
        for (const a of m.level === 'edit' ? entry.actions : entry.readActions) add(a);
      }
    }
    // Implied reference reads (site pickers, product lookups...).
    for (const m of access.modules) for (const a of IMPLIED_READS[m.key] ?? []) add(a);
    return rows;
  }

  private async validateSites(tx: Tx, orgId: string, sites: 'all' | string[] | undefined): Promise<string[] | null> {
    if (!sites || sites === 'all') return null; // null = org-wide
    const unique = [...new Set(sites)];
    if (unique.length === 0) return null;
    const found = await tx.site.findMany({ where: { orgId, id: { in: unique } }, select: { id: true } });
    if (found.length !== unique.length) throw new BadRequestException('Un ou plusieurs sites sélectionnés sont introuvables.');
    return unique;
  }

  /** Replaces a member's custom role permissions and site assignments. */
  private async applyAccess(tx: Tx, orgId: string, userId: string, access: AccessDto) {
    // One custom role per sub-user (name `member:<userId>`, org-scoped).
    // Role has no unique (name, orgId) constraint, so find-or-create.
    const roleName = this.memberRoleName(userId);
    const existingRole = await tx.role.findFirst({ where: { name: roleName, orgId } });
    const role = existingRole ?? (await tx.role.create({ data: { name: roleName, orgId, isSystem: false } }));

    await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
    const perms = await this.actionsFor(access);
    if (perms.length > 0) {
      await tx.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, moduleId: p.moduleId, action: p.action })) });
    }

    const siteIds = await this.validateSites(tx, orgId, access.sites);
    await tx.userRole.deleteMany({ where: { userId, roleId: role.id } });
    if (siteIds === null) {
      await tx.userRole.create({ data: { userId, roleId: role.id, siteId: null } });
    } else {
      await tx.userRole.createMany({ data: siteIds.map((siteId) => ({ userId, roleId: role.id, siteId })) });
    }
    return role.id;
  }

  async create(orgId: string, actorId: string, dto: CreateMemberDto): Promise<MemberView> {
    const taken = await this.prisma.user.findFirst({ where: { OR: [{ username: dto.username }, { email: dto.username }] } });
    if (taken) throw new ConflictException("Ce nom d'utilisateur est déjà pris.");
    if (dto.access.modules.length === 0) throw new BadRequestException('Attribuez au moins un module.');

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    let userId: string;
    try {
      userId = await this.prisma.$transaction(async (tx) => {
        // Interactive transactions aren't auto-wrapped by the RLS extension —
        // set the tenant context so inserts on roles/role_permissions/user_roles
        // satisfy their WITH CHECK policies.
        await setTenantOnTransaction(tx, orgId);
        const user = await tx.user.create({
          data: { orgId, username: dto.username, displayName: dto.displayName ?? null, passwordHash, createdById: actorId, email: null },
        });
        await this.applyAccess(tx, orgId, user.id, dto.access);
        return user.id;
      });
    } catch (err) {
      // The pre-check only sees this org (RLS); the global unique index is the
      // real guard against a username taken in another org.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException("Ce nom d'utilisateur est déjà pris.");
      }
      throw err;
    }
    return this.getOne(orgId, userId);
  }

  async update(orgId: string, actorId: string, userId: string, dto: UpdateMemberDto): Promise<MemberView> {
    const target = await this.loadEditableMember(orgId, userId);
    if (target.id === actorId && dto.isActive === false) throw new BadRequestException('Vous ne pouvez pas désactiver votre propre compte.');

    await this.prisma.$transaction(async (tx) => {
      await setTenantOnTransaction(tx, orgId);
      const data: Prisma.UserUpdateInput = {};
      if (dto.displayName !== undefined) data.displayName = dto.displayName;
      if (dto.isActive !== undefined) data.isActive = dto.isActive;
      if (dto.password) data.passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
      if (Object.keys(data).length > 0) await tx.user.update({ where: { id: userId }, data });
      if (dto.access) await this.applyAccess(tx, orgId, userId, dto.access);
      // Deactivating or changing access: cut live sessions so it takes effect now.
      if (dto.isActive === false || dto.password || dto.access) {
        await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      }
    });
    return this.getOne(orgId, userId);
  }

  async deactivate(orgId: string, actorId: string, userId: string): Promise<MemberView> {
    const target = await this.loadEditableMember(orgId, userId);
    if (target.id === actorId) throw new BadRequestException('Vous ne pouvez pas désactiver votre propre compte.');
    await this.prisma.$transaction(async (tx) => {
      await setTenantOnTransaction(tx, orgId);
      await tx.user.update({ where: { id: userId }, data: { isActive: false } });
      await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    });
    return this.getOne(orgId, userId);
  }

  /** Ensures the target is a sub-user of this org and not an admin (admins aren't edited here). */
  private async loadEditableMember(orgId: string, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, orgId },
      include: { userRoles: { include: { role: { select: { name: true } } } } },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable.');
    if (user.userRoles.some((ur) => ADMIN_ROLE_NAMES.includes(ur.role.name))) {
      throw new ForbiddenException("Ce compte est un administrateur ; sa configuration ne se modifie pas ici.");
    }
    return user;
  }

  async list(orgId: string): Promise<MemberView[]> {
    const [users, { idToKey }, catalog] = await Promise.all([
      this.prisma.user.findMany({
        where: { orgId },
        orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
        include: {
          userRoles: {
            include: {
              role: { select: { id: true, name: true, isSystem: true, rolePermissions: { select: { moduleId: true, action: true } } } },
              site: { select: { id: true, name: true } },
            },
          },
        },
      }),
      this.moduleMaps(),
      this.catalog(),
    ]);
    return users.map((u) => this.toView(u, idToKey, catalog));
  }

  private async getOne(orgId: string, userId: string): Promise<MemberView> {
    const users = await this.list(orgId);
    const view = users.find((u) => u.id === userId);
    if (!view) throw new NotFoundException('Utilisateur introuvable.');
    return view;
  }

  private toView(
    u: Prisma.UserGetPayload<{
      include: { userRoles: { include: { role: { select: { id: true; name: true; isSystem: true; rolePermissions: { select: { moduleId: true; action: true } } } }; site: { select: { id: true; name: true } } } } };
    }>,
    idToKey: Map<string, string>,
    catalog: Map<string, { name: string; actions: string[]; readActions: string[] }>,
  ): MemberView {
    const adminRole = u.userRoles.find((ur) => ADMIN_ROLE_NAMES.includes(ur.role.name));
    const isAdmin = !!adminRole;
    const memberRole = u.userRoles.find((ur) => ur.role.name === `member:${u.id}`);

    let access: MemberView['access'] = null;
    if (!isAdmin && memberRole) {
      // Group this member's permissions per module; level = edit (everything),
      // view (exactly the read actions) or custom (anything in between).
      const byModule = new Map<string, Set<string>>();
      for (const p of memberRole.role.rolePermissions) {
        let key = idToKey.get(p.moduleId);
        if (!key) continue;
        if (p.action.startsWith('invoicing.profile.')) key = 'business';
        if (IMPLIED_SET.has(p.action)) continue; // implied reference reads aren't a module grant
        const set = byModule.get(key) ?? new Set<string>();
        set.add(p.action);
        byModule.set(key, set);
      }
      const modules = [...byModule.entries()].filter(([key, set]) => {
        // Actions granted only through another module's capability (e.g. stock movement via scanning) aren't a module grant.
        const read = catalog.get(key)?.readActions ?? [];
        return read.length === 0 || read.some((a) => set.has(a));
      }).map(([key, set]) => {
        const entry = catalog.get(key);
        const all = entry?.actions ?? [];
        const read = entry?.readActions ?? [];
        const level: 'view' | 'edit' | 'custom' =
          all.length > 0 && all.every((a) => set.has(a)) ? 'edit' : read.length > 0 && set.size === read.length && read.every((a) => set.has(a)) ? 'view' : 'custom';
        return { key, level, actions: [...set] };
      });
      const siteRows = u.userRoles.filter((ur) => ur.role.id === memberRole.role.id);
      const sites: 'all' | { id: string; name: string }[] = siteRows.some((ur) => ur.siteId === null)
        ? 'all'
        : siteRows.filter((ur) => ur.site).map((ur) => ({ id: ur.site!.id, name: ur.site!.name }));
      access = { modules, sites };
    }

    return {
      id: u.id,
      email: u.email,
      username: u.username,
      displayName: u.displayName,
      isActive: u.isActive,
      isAdmin,
      roleName: adminRole?.role.name ?? (memberRole ? 'Membre' : null),
      access,
    };
  }
}
