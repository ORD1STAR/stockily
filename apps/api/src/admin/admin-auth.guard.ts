import { CanActivate, ExecutionContext, createParamDecorator, Injectable, UnauthorizedException } from '@nestjs/common';
import { AdminAuthService } from './admin-auth.service';

export interface AuthenticatedAdmin {
  id: string;
  email: string;
  name: string | null;
}

// Guards every /admin route except login/refresh. Verifies the platform-admin
// access token and attaches the admin to the request.
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly auth: AdminAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException("Jeton d'administration manquant.");
    req.admin = await this.auth.verifyAccess(header.slice('Bearer '.length));
    return true;
  }
}

export const CurrentAdmin = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthenticatedAdmin => ctx.switchToHttp().getRequest().admin);
