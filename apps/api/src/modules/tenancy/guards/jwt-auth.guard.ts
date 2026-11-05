import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

export interface AccessTokenPayload {
  sub: string; // userId
  orgId: string;
}

// First guard in the chain (docs/Action Plan.md §4). Verifies the bearer
// access token and attaches { userId, orgId } to the request as
// `req.authUser` for every guard/handler downstream.
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const authHeader: string | undefined = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Jeton d\'authentification manquant.');
    }

    const token = authHeader.slice('Bearer '.length);
    try {
      const payload = this.jwtService.verify<AccessTokenPayload & { typ?: string; orgId?: string }>(token);
      // Defense in depth: a platform-admin token (signed with the same
      // secret, but carrying `typ` and no orgId) must never authenticate a
      // tenant request — it belongs only to the /admin console.
      if (payload.typ || !payload.orgId) throw new UnauthorizedException();
      req.authUser = { userId: payload.sub, orgId: payload.orgId };
      return true;
    } catch {
      throw new UnauthorizedException('Jeton d\'accès invalide ou expiré.');
    }
  }
}
