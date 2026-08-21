import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { SiteScopeGuard } from './site-scope.guard';

function makeContext(reqOverrides: Record<string, unknown> = {}): ExecutionContext {
  const req = { authUser: { userId: 'user-1', orgId: 'org-1' }, params: {}, body: {}, ...reqOverrides };
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

describe('SiteScopeGuard', () => {
  let prisma: { userRole: { findFirst: jest.Mock } };
  let guard: SiteScopeGuard;

  beforeEach(() => {
    prisma = { userRole: { findFirst: jest.fn() } };
    guard = new SiteScopeGuard(prisma as any);
  });

  it('is a no-op when the route has no siteId', async () => {
    await expect(guard.canActivate(makeContext())).resolves.toBe(true);
    expect(prisma.userRole.findFirst).not.toHaveBeenCalled();
  });

  it('allows an org-wide role assignment for any site', async () => {
    prisma.userRole.findFirst.mockResolvedValue({ id: 'ur-1', siteId: null });
    await expect(guard.canActivate(makeContext({ params: { siteId: 'site-1' } }))).resolves.toBe(true);
  });

  it('allows a role assignment scoped to the exact matching site', async () => {
    prisma.userRole.findFirst.mockResolvedValue({ id: 'ur-1', siteId: 'site-1' });
    await expect(guard.canActivate(makeContext({ params: { siteId: 'site-1' } }))).resolves.toBe(true);
  });

  it('denies when the user has no role touching this site at all', async () => {
    prisma.userRole.findFirst.mockResolvedValue(null);
    await expect(guard.canActivate(makeContext({ params: { siteId: 'site-9' } }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('reads siteId from the body when not present in params', async () => {
    prisma.userRole.findFirst.mockResolvedValue({ id: 'ur-1', siteId: null });
    await guard.canActivate(makeContext({ body: { siteId: 'site-7' } }));
    expect(prisma.userRole.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1', OR: [{ siteId: null }, { siteId: 'site-7' }] } }),
    );
  });

  it('reads siteId from the query string (Milestone 2 list/consolidated-view endpoints)', async () => {
    prisma.userRole.findFirst.mockResolvedValue({ id: 'ur-1', siteId: 'site-3' });
    await guard.canActivate(makeContext({ query: { siteId: 'site-3' } }));
    expect(prisma.userRole.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1', OR: [{ siteId: null }, { siteId: 'site-3' }] } }),
    );
  });

  it('is a no-op for ?site=all — filtering an all-sites request is SiteAccessService\'s job, not this guard\'s', async () => {
    await expect(guard.canActivate(makeContext({ query: { siteId: 'all' } }))).resolves.toBe(true);
    expect(prisma.userRole.findFirst).not.toHaveBeenCalled();
  });
});
