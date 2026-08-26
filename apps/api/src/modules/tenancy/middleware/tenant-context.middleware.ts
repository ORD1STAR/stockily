import { Injectable, NestMiddleware } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { NextFunction, Request, Response } from 'express';
import { runWithTenant } from '@org/infra-db';
import { AccessTokenPayload } from '../guards/jwt-auth.guard';

// Milestone 8 (RLS) — populates the AsyncLocalStorage tenant context
// (`@org/infra-db`'s `runWithTenant`) for the rest of the request, so
// `withTenantRls`'s Prisma extension can issue `SET LOCAL app.tenant_id`
// on every query, including the ones `ModuleEntitlementGuard`/
// `PermissionGuard` make — which run *before* any interceptor, so this has
// to be Express middleware (runs before guards), not an interceptor.
//
// Deliberately duplicates JwtAuthGuard's own verification instead of
// reading something JwtAuthGuard already set — middleware runs *before*
// guards in Nest's request lifecycle, so nothing from JwtAuthGuard exists
// yet at this point. This never throws or rejects a request itself: an
// invalid/missing/expired token here just means no tenant context gets
// set, and the request proceeds with `getCurrentTenantId()` returning
// `undefined` for its whole lifetime — JwtAuthGuard (running right after,
// within the same still-open `runWithTenant` scope) remains the sole
// authority that actually rejects an unauthenticated request with 401.
@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  constructor(private readonly jwtService: JwtService) {}

  use(req: Request, _res: Response, next: NextFunction) {
    const authHeader = req.headers['authorization'];
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      try {
        const payload = this.jwtService.verify<AccessTokenPayload>(authHeader.slice('Bearer '.length));
        // Calling `next()` synchronously inside this callback (not
        // returning it unawaited from outside) is what keeps the whole
        // downstream chain — guards, controller, every Prisma query along
        // the way — inside the AsyncLocalStorage-active window; see
        // `runWithTenant`'s own doc for the (verified) reasoning.
        void runWithTenant(payload.orgId, () => next());
        return;
      } catch {
        // Invalid/expired token — fall through with no tenant context; see
        // the class doc above for why this doesn't reject the request here.
      }
    }
    next();
  }
}
