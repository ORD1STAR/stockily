import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ModuleEntitlementGuard } from './module-entitlement.guard';
import { ModuleEntitlementException } from '../exceptions/module-entitlement.exception';
import { EntitlementCacheService } from '../services/entitlement-cache.service';

function makeContext(reqOverrides: Record<string, unknown> = {}): ExecutionContext {
  const req = { authUser: { userId: 'user-1', orgId: 'org-1' }, ...reqOverrides };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => jest.fn(),
  } as unknown as ExecutionContext;
}

describe('ModuleEntitlementGuard', () => {
  let prisma: { module: { findUnique: jest.Mock }; organizationModuleEntitlement: { findUnique: jest.Mock } };
  let reflector: Reflector;
  let cache: EntitlementCacheService;
  let guard: ModuleEntitlementGuard;

  beforeEach(() => {
    prisma = {
      module: { findUnique: jest.fn() },
      organizationModuleEntitlement: { findUnique: jest.fn() },
    };
    reflector = new Reflector();
    cache = new EntitlementCacheService();
    guard = new ModuleEntitlementGuard(reflector, prisma as any, cache);
  });

  it('allows the request through when the route has no @RequiresModule', async () => {
    jest.spyOn(reflector, 'get').mockReturnValue(undefined);
    await expect(guard.canActivate(makeContext())).resolves.toBe(true);
    expect(prisma.module.findUnique).not.toHaveBeenCalled();
  });

  it('allows an active (non-trial) entitlement', async () => {
    jest.spyOn(reflector, 'get').mockReturnValue('stock');
    prisma.module.findUnique.mockResolvedValue({ id: 'mod-1', key: 'stock' });
    prisma.organizationModuleEntitlement.findUnique.mockResolvedValue({ status: 'active', trialEndsAt: null });

    await expect(guard.canActivate(makeContext())).resolves.toBe(true);
  });

  it('allows a trial entitlement that has not yet expired', async () => {
    jest.spyOn(reflector, 'get').mockReturnValue('stock');
    prisma.module.findUnique.mockResolvedValue({ id: 'mod-1', key: 'stock' });
    prisma.organizationModuleEntitlement.findUnique.mockResolvedValue({
      status: 'trial',
      trialEndsAt: new Date(Date.now() + 60_000),
    });

    await expect(guard.canActivate(makeContext())).resolves.toBe(true);
  });

  it('rejects an expired trial with a 402 ModuleEntitlementException', async () => {
    jest.spyOn(reflector, 'get').mockReturnValue('stock');
    prisma.module.findUnique.mockResolvedValue({ id: 'mod-1', key: 'stock' });
    prisma.organizationModuleEntitlement.findUnique.mockResolvedValue({
      status: 'trial',
      trialEndsAt: new Date(Date.now() - 60_000),
    });

    await expect(guard.canActivate(makeContext())).rejects.toBeInstanceOf(ModuleEntitlementException);
  });

  it('rejects when there is no entitlement row at all', async () => {
    jest.spyOn(reflector, 'get').mockReturnValue('quality');
    prisma.module.findUnique.mockResolvedValue({ id: 'mod-2', key: 'quality' });
    prisma.organizationModuleEntitlement.findUnique.mockResolvedValue(null);

    await expect(guard.canActivate(makeContext())).rejects.toBeInstanceOf(ModuleEntitlementException);
  });

  it('rejects a suspended/cancelled entitlement even if trialEndsAt is still in the future', async () => {
    jest.spyOn(reflector, 'get').mockReturnValue('stock');
    prisma.module.findUnique.mockResolvedValue({ id: 'mod-1', key: 'stock' });
    prisma.organizationModuleEntitlement.findUnique.mockResolvedValue({
      status: 'cancelled',
      trialEndsAt: new Date(Date.now() + 60_000),
    });

    await expect(guard.canActivate(makeContext())).rejects.toBeInstanceOf(ModuleEntitlementException);
  });

  it('caches the DB result and does not re-query within the TTL', async () => {
    jest.spyOn(reflector, 'get').mockReturnValue('stock');
    prisma.module.findUnique.mockResolvedValue({ id: 'mod-1', key: 'stock' });
    prisma.organizationModuleEntitlement.findUnique.mockResolvedValue({ status: 'active', trialEndsAt: null });

    await guard.canActivate(makeContext());
    await guard.canActivate(makeContext());

    expect(prisma.organizationModuleEntitlement.findUnique).toHaveBeenCalledTimes(1);
  });
});
