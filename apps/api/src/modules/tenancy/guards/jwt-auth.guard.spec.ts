import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';

function makeContext(headers: Record<string, string> = {}) {
  const req: { headers: Record<string, string>; authUser?: unknown } = { headers };
  const ctx = { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
  return { ctx, req };
}

describe('JwtAuthGuard', () => {
  it('rejects a request with no Authorization header', () => {
    const jwtService = { verify: jest.fn() };
    const guard = new JwtAuthGuard(jwtService as any);
    const { ctx } = makeContext();

    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
    expect(jwtService.verify).not.toHaveBeenCalled();
  });

  it('rejects a header that is not a Bearer token', () => {
    const jwtService = { verify: jest.fn() };
    const guard = new JwtAuthGuard(jwtService as any);
    const { ctx } = makeContext({ authorization: 'Basic abc123' });

    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('rejects an invalid/expired token', () => {
    const jwtService = {
      verify: jest.fn(() => {
        throw new Error('jwt expired');
      }),
    };
    const guard = new JwtAuthGuard(jwtService as any);
    const { ctx } = makeContext({ authorization: 'Bearer bad-token' });

    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('attaches { userId, orgId } to the request on a valid token', () => {
    const jwtService = { verify: jest.fn(() => ({ sub: 'user-1', orgId: 'org-1' })) };
    const guard = new JwtAuthGuard(jwtService as any);
    const { ctx, req } = makeContext({ authorization: 'Bearer good-token' });

    expect(guard.canActivate(ctx)).toBe(true);
    expect(req.authUser).toEqual({ userId: 'user-1', orgId: 'org-1' });
  });
});
