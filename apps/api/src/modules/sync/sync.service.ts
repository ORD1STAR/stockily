import { ForbiddenException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { setTenantOnTransaction } from '@org/infra-db';
import { PrismaService } from '../../prisma/prisma.service';
import { CounterKey, reserveNumberBlock } from '../invoicing/document-numbering';
import { AuthenticatedDevice } from './device-auth.guard';
import { snapshotModels } from './snapshot-models';

export const DEFAULT_BLOCK_SIZE = 50;

type Delegate = { findMany: (args: object) => Promise<unknown[]> };

@Injectable()
export class SyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * A normal access token for one of the device's org users. Replayed
   * outbox entries must run as the user who did the action offline (same
   * permissions, same audit trail) — the device proves it may act for the
   * org with its license; this only picks which user.
   */
  async session(device: AuthenticatedDevice, userId: string) {
    const user = await this.prisma.$transaction(async (tx) => {
      await setTenantOnTransaction(tx, device.orgId);
      return tx.user.findFirst({ where: { id: userId, orgId: device.orgId } });
    });
    if (!user) throw new ForbiddenException({ statusCode: 403, error: 'unknown_user', message: 'Utilisateur inconnu pour cette organisation.' });
    return { accessToken: this.jwt.sign({ sub: user.id, orgId: user.orgId }) };
  }

  /** Everything the device needs to run the org's day-to-day offline. */
  async snapshot(device: AuthenticatedDevice) {
    return this.prisma.$transaction(
      async (tx) => {
        await setTenantOnTransaction(tx, device.orgId);
        const models: Record<string, unknown[]> = {};
        for (const m of snapshotModels()) {
          const delegate = (tx as unknown as Record<string, Delegate>)[m.delegate];
          models[m.name] = await delegate.findMany({ where: m.where(device.orgId) });
        }
        const numberBlocks = await tx.numberBlock.findMany({ where: { orgId: device.orgId, deviceActivationId: device.id, releasedAt: null } });
        return { generatedAt: new Date().toISOString(), orgId: device.orgId, deviceActivationId: device.id, models, numberBlocks };
      },
      // One consistent read across ~45 tables; a large org takes a while.
      { timeout: 120_000, maxWait: 10_000, isolationLevel: 'RepeatableRead' },
    );
  }

  async reserveBlock(device: AuthenticatedDevice, counterKey: CounterKey, size = DEFAULT_BLOCK_SIZE) {
    return this.prisma.$transaction(async (tx) => {
      await setTenantOnTransaction(tx, device.orgId);
      return reserveNumberBlock(tx, device.orgId, device.id, counterKey, size);
    });
  }

  /** Admin view: what each device replayed, and what failed to sync. */
  async replays(orgId: string, status?: string) {
    return this.prisma.$transaction(async (tx) => {
      await setTenantOnTransaction(tx, orgId);
      return tx.syncReplayLog.findMany({
        where: { orgId, ...(status ? { status } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: { id: true, deviceActivationId: true, userId: true, method: true, path: true, status: true, httpStatus: true, error: true, createdAt: true },
      });
    });
  }
}
