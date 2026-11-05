import { HttpException, Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { NextFunction, Request, Response } from 'express';
import { runWithTenant } from '@org/infra-db';
import { PrismaService } from '../../prisma/prisma.service';
import { AllocatedNumber, runWithNumbering } from '../invoicing/document-numbering';
import { LICENSE_HEADER } from '../licensing/license-token.service';
import { LicensingService } from '../licensing/licensing.service';
import { AccessTokenPayload } from '../tenancy/guards/jwt-auth.guard';

export const IDEMPOTENCY_HEADER = 'x-stockily-idempotency-key';
export const REPLAY_NUMBERS_HEADER = 'x-stockily-replay-numbers';

function parseNumbers(raw: unknown): AllocatedNumber[] {
  if (typeof raw !== 'string' || !raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('not an array');
  return parsed.map((n) => {
    if (typeof n?.key !== 'string' || !Number.isInteger(n?.year) || !Number.isInteger(n?.value)) throw new Error('bad entry');
    return { key: n.key, year: n.year, value: n.value };
  });
}

/**
 * Active only on requests a desktop device replays from its outbox
 * (they carry an idempotency key + the device license). Any other request
 * passes straight through.
 *
 * 1. Idempotency: a key already applied is answered from sync_replay_log
 *    without touching the business code again — a device whose connection
 *    dropped after the server applied an entry can safely retry it.
 * 2. Numbering: the numbers the device consumed offline (already printed on
 *    paper) are handed to the allocator, which reuses them after checking
 *    they belong to this device's reserved blocks.
 * 3. Every replay — applied or failed — is logged; failures are what the
 *    org admin reviews.
 *
 * Known gap: the log row is written after the response, outside the
 * business transaction, so a retry landing in that few-ms window could
 * apply twice. Devices only retry after a timeout/failure, so in practice
 * the window is never hit, but it isn't transactionally impossible.
 */
@Injectable()
export class ReplayMiddleware implements NestMiddleware {
  private readonly logger = new Logger(ReplayMiddleware.name);

  constructor(
    private readonly licensing: LicensingService,
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const key = req.headers[IDEMPOTENCY_HEADER];
    if (typeof key !== 'string' || !key) return next();

    let device: { id: string; orgId: string };
    let numbers: AllocatedNumber[];
    try {
      device = await this.licensing.authenticateDevice(String(req.headers[LICENSE_HEADER] ?? ''));
      const bearer = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
      const user = this.jwt.verify<AccessTokenPayload>(bearer);
      if (user.orgId !== device.orgId) {
        return res.status(403).json({ statusCode: 403, error: 'org_mismatch', message: 'Utilisateur et appareil d’organisations différentes.' });
      }
      numbers = parseNumbers(req.headers[REPLAY_NUMBERS_HEADER]);
    } catch (err) {
      if (err instanceof HttpException) return res.status(err.getStatus()).json(err.getResponse());
      return res.status(400).json({ statusCode: 400, error: 'bad_replay', message: 'Requête de synchronisation invalide.' });
    }

    const existing = await runWithTenant(device.orgId, () => this.prisma.syncReplayLog.findUnique({ where: { idempotencyKey: key } }));
    if (existing && existing.status === 'applied') {
      res.setHeader('x-stockily-replayed', '1');
      return res.status(existing.httpStatus).json(existing.responseBody ?? null);
    }

    let captured: unknown;
    const originalSend = res.send.bind(res);
    res.send = (body?: unknown) => {
      captured = body;
      return originalSend(body);
    };

    res.on('finish', () => {
      const ok = res.statusCode < 400;
      let json: unknown;
      try {
        json = typeof captured === 'string' ? JSON.parse(captured) : Buffer.isBuffer(captured) ? null : (captured ?? null);
      } catch {
        json = null;
      }
      const message = !ok && json && typeof json === 'object' ? (json as { message?: unknown }).message : undefined;
      const data = {
        orgId: device.orgId,
        deviceActivationId: device.id,
        userId: (req as Request & { authUser?: { userId: string } }).authUser?.userId ?? 'unknown',
        method: req.method,
        path: req.originalUrl,
        status: ok ? 'applied' : 'failed',
        httpStatus: res.statusCode,
        responseBody: ok ? (json as Prisma.InputJsonValue) ?? Prisma.JsonNull : Prisma.JsonNull,
        error: ok ? null : Array.isArray(message) ? message.join(', ') : typeof message === 'string' ? message : `HTTP ${res.statusCode}`,
      };
      runWithTenant(device.orgId, () =>
        this.prisma.syncReplayLog.upsert({ where: { idempotencyKey: key }, create: { idempotencyKey: key, ...data }, update: data }),
      ).catch((err) => this.logger.error(`Failed to record replay ${key}`, err));
    });

    runWithNumbering({ mode: 'replay', orgId: device.orgId, deviceActivationId: device.id, preassigned: numbers, allocated: [] }, () => next());
  }
}
