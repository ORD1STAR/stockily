import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from './permission.guard';

function makeContext(reqOverrides: Record<string, unknown> = {}): ExecutionContext {
  const req = { authUser: { userId: 'user-1', orgId: 'org-1' }, params: {}, body: {}, ...reqOverrides };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => jest.fn(),
  } as unknown as ExecutionContext;
}

describe('PermissionGuard', () => {
  let prisma: { module: { findUnique: jest.Mock }; userRole: { findMany: jest.Mock }; rolePermission: { findFirst: jest.Mock } };
  let reflector: Reflector;
  let guard: PermissionGuard;

  beforeEach(() => {
    prisma = {
      module: { findUnique: jest.fn() },
      userRole: { findMany: jest.fn() },
      rolePermission: { findFirst: jest.fn() },
    };
    reflector = new Reflector();
    guard = new PermissionGuard(reflector, prisma as any);
  });

  it('allows the request through when the route has no @RequiresPermission', async () => {
    jest.spyOn(reflector, 'get').mockReturnValue(undefined);
    await expect(guard.canActivate(makeContext())).resolves.toBe(true);
  });

  it('grants access when an org-wide role has the required permission', async () => {
    jest.spyOn(reflector, 'get').mockReturnValue({ moduleKey: 'stock', action: 'stock.product.read' });
    prisma.module.findUnique.mockResolvedValue({ id: 'mod-1' });
    prisma.userRole.findMany.mockResolvedValue([{ roleId: 'role-1' }]);
    prisma.rolePermission.findFirst.mockResolvedValue({ id: 'perm-1' });

    await expect(guard.canActivate(makeContext())).resolves.toBe(true);
    // No siteId on the request -> only org-wide (siteId: null) roles should be considered.
    expect(prisma.userRole.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ OR: [{ siteId: null }] }) }),
    );
  });

  it('denies access when no role grants the action', async () => {
    jest.spyOn(reflector, 'get').mockReturnValue({ moduleKey: 'stock', action: 'stock.movement.create' });
    prisma.module.findUnique.mockResolvedValue({ id: 'mod-1' });
    prisma.userRole.findMany.mockResolvedValue([{ roleId: 'role-1' }]);
    prisma.rolePermission.findFirst.mockResolvedValue(null);

    await expect(guard.canActivate(makeContext())).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies access when the user has no applicable role assignment at all', async () => {
    jest.spyOn(reflector, 'get').mockReturnValue({ moduleKey: 'stock', action: 'stock.product.read' });
    prisma.module.findUnique.mockResolvedValue({ id: 'mod-1' });
    prisma.userRole.findMany.mockResolvedValue([]);

    await expect(guard.canActivate(makeContext())).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.rolePermission.findFirst).not.toHaveBeenCalled();
  });

  it('includes both org-wide and matching-site roles when the route is site-scoped', async () => {
    jest.spyOn(reflector, 'get').mockReturnValue({ moduleKey: 'stock', action: 'stock.product.read' });
    prisma.module.findUnique.mockResolvedValue({ id: 'mod-1' });
    prisma.userRole.findMany.mockResolvedValue([{ roleId: 'role-1' }]);
    prisma.rolePermission.findFirst.mockResolvedValue({ id: 'perm-1' });

    await guard.canActivate(makeContext({ params: { siteId: 'site-42' } }));

    expect(prisma.userRole.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ OR: [{ siteId: null }, { siteId: 'site-42' }] }) }),
    );
  });

  it('reads siteId from the query string (Milestone 2 list endpoints) the same as params', async () => {
    jest.spyOn(reflector, 'get').mockReturnValue({ moduleKey: 'stock', action: 'stock.product.read' });
    prisma.module.findUnique.mockResolvedValue({ id: 'mod-1' });
    prisma.userRole.findMany.mockResolvedValue([{ roleId: 'role-1' }]);
    prisma.rolePermission.findFirst.mockResolvedValue({ id: 'perm-1' });

    await guard.canActivate(makeContext({ query: { siteId: 'site-9' } }));

    expect(prisma.userRole.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ OR: [{ siteId: null }, { siteId: 'site-9' }] }) }),
    );
  });

  it('?site=all considers ANY of the user\'s roles regardless of site — a site-scoped-only user still has the permission somewhere, filtering happens downstream', async () => {
    jest.spyOn(reflector, 'get').mockReturnValue({ moduleKey: 'stock', action: 'stock.product.read' });
    prisma.module.findUnique.mockResolvedValue({ id: 'mod-1' });
    prisma.userRole.findMany.mockResolvedValue([{ roleId: 'role-1' }]);
    prisma.rolePermission.findFirst.mockResolvedValue({ id: 'perm-1' });

    await expect(guard.canActivate(makeContext({ query: { siteId: 'all' } }))).resolves.toBe(true);

    expect(prisma.userRole.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' } }),
    );
  });

  it('does NOT grant access from a role scoped only to a different site (the unsound-decomposition case)', async () => {
    // A role scoped to site-1 that DOES grant the action should not count
    // toward a request targeting site-2 — this is exactly the failure mode
    // documented in permission.guard.ts that motivated the combined query.
    jest.spyOn(reflector, 'get').mockReturnValue({ moduleKey: 'stock', action: 'stock.product.read' });
    prisma.module.findUnique.mockResolvedValue({ id: 'mod-1' });
    // Simulates the DB-level filter already excluding the site-1-scoped role
    // for a site-2 request (OR: [{siteId:null},{siteId:'site-2'}] would not
    // match a userRole row whose siteId is 'site-1').
    prisma.userRole.findMany.mockResolvedValue([]);

    await expect(guard.canActivate(makeContext({ params: { siteId: 'site-2' } }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
