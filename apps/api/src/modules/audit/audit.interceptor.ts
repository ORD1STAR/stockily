import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { Observable, tap } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';
import { AUDIT_KEY, AuditMeta } from './audit.decorator';

// The shapes of the handler results this interceptor knows how to read an
// org/actor/entity id out of. Loose by design — every future controller
// using @Audit(...) either runs authenticated (req.authUser covers it) or
// returns one of these two conventional shapes.
interface AuditableResult {
  organization?: { id: string };
  user?: { id: string };
  id?: string;
  orgId?: string;
}

const SENSITIVE_KEY_PATTERN = /password|token|secret/i;

// Recursively strips anything that looks like a credential before it's
// persisted as the audit log's `diff` — never write a plaintext password
// into a table that (per §11's 10-year Algerian retention requirement)
// is expected to live for a long time.
function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SENSITIVE_KEY_PATTERN.test(k) ? '[redacted]' : sanitize(v),
      ]),
    );
  }
  return value;
}

// Generic across all mutating endpoints that opt in via @Audit(...). Wired
// onto POST /auth/signup as the working example this milestone; Stock/
// Quality/Invoicing controllers in later milestones adopt the same
// decorator once they exist — no interceptor changes needed for them.
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<AuditMeta | undefined>(AUDIT_KEY, context.getHandler());
    if (!meta) return next.handle();

    const req = context.switchToHttp().getRequest();

    return next.handle().pipe(
      tap((result: unknown) => {
        // Prefer the authenticated identity when one exists (every
        // mutating endpoint added from Milestone 2 onward runs behind
        // JwtAuthGuard, so req.authUser will be set). Signup is the one
        // endpoint in this milestone that mutates *before* an identity
        // exists, so it falls back to reading the freshly created
        // organization/user out of the handler's own return value.
        const r = result as AuditableResult | undefined;
        const orgId: string | undefined = req.authUser?.orgId ?? r?.organization?.id ?? r?.orgId;
        const actorId: string | undefined = req.authUser?.userId ?? r?.user?.id ?? r?.id;
        const entityId: string | undefined = r?.organization?.id ?? r?.id ?? orgId;

        if (!orgId || !entityId) {
          this.logger.warn(`Skipped audit log for ${meta.action}: could not resolve orgId/entityId from response.`);
          return;
        }

        this.prisma.auditLog
          .create({
            data: {
              orgId,
              actorId: actorId ?? null,
              entityType: meta.entityType,
              entityId,
              action: meta.action,
              diff: sanitize(req.body) as Prisma.InputJsonValue,
            },
          })
          // Audit-write failure must not take down the primary request —
          // it has already succeeded and responded by the time this runs.
          // Logged loudly so a silent gap in the trail is at least visible
          // in server logs, not silently swallowed.
          .catch((err) => this.logger.error(`Failed to write audit log for ${meta.action}`, err));
      }),
    );
  }
}
