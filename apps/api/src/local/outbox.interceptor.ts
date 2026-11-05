import { CallHandler, ExecutionContext, ForbiddenException, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Observable, finalize, mergeMap } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingStore, runWithNumbering } from '../modules/invoicing/document-numbering';
import { LocalStateService } from './local-state.service';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Never replayed: local sessions, device/sync machinery, and inventory
// counts (online-only, proxied straight to the server).
const NOT_RECORDED = ['/api/auth/', '/api/local/', '/api/licensing/', '/api/sync/', '/api/inventory/counts'];

export function isRecordable(method: string, path: string): boolean {
  return MUTATING.has(method) && path.startsWith('/api/') && !NOT_RECORDED.some((p) => path.startsWith(p));
}

/**
 * Local mode only. Every successful mutating request is recorded in the
 * device outbox — method, path, body, the response it got locally (used to
 * map locally-created ids to the server's on replay) and the document
 * numbers it consumed from the device's blocks — so the sync engine can
 * replay it on the server later. Also where read-only mode is enforced:
 * an expired/revoked license blocks writes here, server-side of the UI,
 * not just as a hidden button.
 */
@Injectable()
export class OutboxInterceptor implements NestInterceptor {
  private readonly logger = new Logger(OutboxInterceptor.name);

  constructor(
    private readonly state: LocalStateService,
    private readonly prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest();
    const path: string = req.originalUrl ?? req.url;
    if (!isRecordable(req.method, path)) return next.handle();

    if (this.state.readOnly) {
      throw new ForbiddenException({
        statusCode: 403,
        error: this.state.revoked ? 'device_revoked' : 'license_expired',
        message: this.state.revoked
          ? 'Cet appareil a été désactivé. La consultation reste possible ; reconnectez-vous pour le réactiver.'
          : 'Licence expirée : connectez cet ordinateur à internet pour la renouveler. La consultation et l’impression restent possibles.',
      });
    }

    return new Observable((subscriber) => {
      let release: (() => void) | undefined;
      let cancelled = false;
      let inner: { unsubscribe(): void } | undefined;
      this.state.lock.acquireRead().then(
        (rel) => {
          release = rel;
          if (cancelled) return rel();
          const store: NumberingStore = { mode: 'local', deviceActivationId: this.state.deviceId, preassigned: [], allocated: [] };
          // next.handle() binds its async context when called, so calling it
          // inside runWithNumbering is what puts the store in scope for the
          // handler (and therefore for allocateNumber).
          inner = runWithNumbering(store, () =>
            next
              .handle()
              .pipe(
                mergeMap(async (result) => {
                  await this.record(req, path, result, store);
                  return result;
                }),
                finalize(() => release?.()),
              )
              .subscribe(subscriber),
          );
        },
        (err) => subscriber.error(err),
      );
      return () => {
        cancelled = true;
        inner?.unsubscribe();
        release?.();
      };
    });
  }

  private async record(req: { authUser?: { userId: string }; method: string; body?: unknown }, path: string, result: unknown, store: NumberingStore) {
    try {
      await this.prisma.localOutboxEntry.create({
        data: {
          userId: req.authUser?.userId ?? 'unknown',
          method: req.method,
          path,
          body: (req.body ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          localResponse: result === undefined || result === null ? Prisma.JsonNull : (JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue),
          numbers: store.allocated as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      // The local write already committed; losing its outbox entry means it
      // won't reach the server. Loud, because that's data loss on next pull.
      this.logger.error(`Could not record ${req.method} ${path} in the outbox`, err instanceof Error ? err.stack : err);
    }
  }
}
