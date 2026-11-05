// Phase D: in local (desktop) mode the entitlement guard trusts the SIGNED
// license token's module list, NOT the device's local database — so editing
// organization_module_entitlements locally unlocks nothing. This verifies the
// guard consults the token-derived set and never touches Prisma in local mode.
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ModuleEntitlementGuard } from './module-entitlement.guard';
import { ModuleEntitlementException } from '../exceptions/module-entitlement.exception';
import { setLocalActiveModuleKeys } from '../../../local/local-entitlements';

function ctx(moduleKey: string): ExecutionContext {
  const req = { authUser: { orgId: 'org-1', userId: 'u1' } };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => jest.fn(),
    getClass: () => jest.fn(),
  } as unknown as ExecutionContext;
}

describe('ModuleEntitlementGuard — local mode (signed token)', () => {
  const reflector = new Reflector();
  // A Prisma that fails if touched — proves the DB is NOT consulted in local mode.
  const prisma = {
    module: { findUnique: jest.fn(() => { throw new Error('DB must not be consulted in local mode'); }) },
    organizationModuleEntitlement: { findUnique: jest.fn(() => { throw new Error('DB must not be consulted in local mode'); }) },
  };
  const cache = { get: () => undefined, set: () => undefined };
  const guard = new ModuleEntitlementGuard(reflector, prisma as never, cache as never);

  beforeAll(() => {
    process.env.STOCKILY_LOCAL_MODE = '1';
  });
  afterAll(() => {
    delete process.env.STOCKILY_LOCAL_MODE;
    setLocalActiveModuleKeys(null);
  });

  it('allows a module present in the signed token', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('stock');
    setLocalActiveModuleKeys(['stock', 'invoicing']);
    await expect(guard.canActivate(ctx('stock'))).resolves.toBe(true);
  });

  it('denies a module NOT in the token even if the local DB would say active', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('cash');
    setLocalActiveModuleKeys(['stock', 'invoicing']); // no 'cash' — a local INSERT can't add it
    await expect(guard.canActivate(ctx('cash'))).rejects.toBeInstanceOf(ModuleEntitlementException);
  });
});
