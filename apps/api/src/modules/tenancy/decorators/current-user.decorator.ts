import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthenticatedUser {
  userId: string;
  orgId: string;
}

// Populated by JwtAuthGuard. Typed accessor so controllers don't reach into
// `req.authUser` with an implicit any.
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const req = ctx.switchToHttp().getRequest();
    return req.authUser;
  },
);
