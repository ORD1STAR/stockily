import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { LICENSE_HEADER } from '../modules/licensing/license-token.service';
import { DEVICE_COUNTER_KEYS } from '../modules/sync/snapshot-models';
import { IDEMPOTENCY_HEADER, REPLAY_NUMBERS_HEADER } from '../modules/sync/replay.middleware';
import { pairIds, rewriteIds, uuidsIn } from './id-mapping';
import { localEnv } from './local-env';
import { LocalStateService } from './local-state.service';
import { loadSnapshot, Snapshot } from './snapshot-loader';

const BLOCK_SIZE = 50;
const BLOCK_LOW_WATER = 15;

class Offline extends Error {}

/**
 * The device side of sync, run on a timer while the desktop app is open:
 *   1. push — replay pending outbox entries on the server, in order, as the
 *      user who made them; map the ids the server assigned to rows created
 *      offline; a 4xx parks the entry as `failed` (shown on the Synchronisation
 *      page — never silently dropped), a 5xx/network error stops and retries later.
 *   2. pull — once nothing is pending, replace the local copy with a fresh
 *      server snapshot (server is authoritative).
 *   3. top up — keep a reserve of document numbers for offline use.
 */
@Injectable()
export class LocalSyncService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(LocalSyncService.name);
  private readonly env = localEnv();
  private readonly admin = new PrismaClient({ datasourceUrl: this.env.adminDatabaseUrl });
  private timer: NodeJS.Timeout | null = null;
  private remoteTokens = new Map<string, { token: string; until: number }>();
  private pullRequested = false;

  constructor(private readonly state: LocalStateService) {
    // A license renewed on demand (module bought online): pull the data it unlocks.
    state.onRenewed(() => this.requestPull());
  }

  async onApplicationBootstrap() {
    // First start after activation: nothing to log into yet — load the org
    // before the API starts listening (the desktop shell shows a progress
    // screen meanwhile; activation is always done online).
    if ((await this.admin.organization.count()) === 0 && this.state.licenseToken) {
      try {
        await this.pull();
        await this.topUpBlocks();
      } catch (err) {
        this.state.lastError = err instanceof Error ? err.message : String(err);
        this.logger.error('Initial snapshot failed', err);
      }
    }
    this.timer = setInterval(() => void this.tick(), this.env.tickIntervalMs);
    void this.tick();
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.admin.$disconnect();
  }

  requestPull() {
    this.pullRequested = true;
    void this.tick();
  }

  /** One sync round; overlapping calls are coalesced. */
  async tick(): Promise<void> {
    if (this.state.syncing || !this.state.licenseToken || this.state.revoked) return;
    this.state.syncing = true;
    try {
      this.state.online = await this.ping();
      if (!this.state.online) return;
      const pushed = await this.push();
      const pending = await this.admin.localOutboxEntry.count({ where: { status: 'pending' } });
      const due = !this.state.lastPullAt || Date.now() - this.state.lastPullAt.getTime() > this.env.pullIntervalMs;
      if (pending === 0 && (pushed > 0 || due || this.pullRequested)) {
        this.pullRequested = false;
        await this.pull();
      }
      await this.topUpBlocks();
      this.state.lastError = null;
    } catch (err) {
      if (err instanceof Offline) this.state.online = false;
      this.state.lastError = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Sync round stopped: ${this.state.lastError}`);
    } finally {
      this.state.syncing = false;
    }
  }

  private async ping(): Promise<boolean> {
    try {
      const r = await fetch(`${this.env.remoteOrigin}/api/sync/ping`, { signal: AbortSignal.timeout(5000) });
      return r.ok;
    } catch {
      return false;
    }
  }

  private async remote(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
    try {
      return await fetch(`${this.env.remoteOrigin}${path}`, { ...init, signal: AbortSignal.timeout(init.timeoutMs ?? 30_000) });
    } catch (err) {
      throw new Offline(`Serveur injoignable (${err instanceof Error ? err.message : err})`);
    }
  }

  /** Device-authenticated call; a revoked/deactivated device stops syncing. */
  private async deviceCall(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
    const r = await this.remote(path, { ...init, headers: { ...(init.headers ?? {}), [LICENSE_HEADER]: this.state.licenseToken, 'Content-Type': 'application/json' } });
    if (r.status === 401) {
      const body = (await r.clone().json().catch(() => ({}))) as { error?: string };
      if (body?.error === 'device_revoked' || body?.error === 'device_deactivated') this.state.revoked = body.error;
    }
    return r;
  }

  /** A server access token for one of the org's users, so a replay runs as whoever did the action offline. */
  async remoteTokenFor(userId: string, fresh = false): Promise<string> {
    const cached = this.remoteTokens.get(userId);
    if (!fresh && cached && cached.until > Date.now()) return cached.token;
    const r = await this.deviceCall('/api/sync/session', { method: 'POST', body: JSON.stringify({ userId }) });
    if (!r.ok) throw new Error(`Session serveur refusée (${r.status})`);
    const { accessToken } = (await r.json()) as { accessToken: string };
    this.remoteTokens.set(userId, { token: accessToken, until: Date.now() + 10 * 60_000 });
    return accessToken;
  }

  private async push(): Promise<number> {
    let applied = 0;
    const entries = await this.admin.localOutboxEntry.findMany({ where: { status: 'pending' }, orderBy: { createdAt: 'asc' } });
    for (const e of entries) {
      const rawBody = e.body === null ? '' : JSON.stringify(e.body);
      const ids = uuidsIn(`${e.path} ${rawBody}`);
      const known = ids.length ? await this.admin.localIdMap.findMany({ where: { localId: { in: ids } } }) : [];
      const map = new Map(known.map((k) => [k.localId, k.remoteId]));
      const path = rewriteIds(e.path, map);
      const body = rawBody ? rewriteIds(rawBody, map) : undefined;

      const send = async (fresh: boolean) =>
        this.deviceCall(path, {
          method: e.method,
          body,
          headers: {
            Authorization: `Bearer ${await this.remoteTokenFor(e.userId, fresh)}`,
            [IDEMPOTENCY_HEADER]: e.id,
            [REPLAY_NUMBERS_HEADER]: JSON.stringify(e.numbers ?? []),
          },
        });

      let r: Response;
      try {
        r = await send(false);
        if (r.status === 401 && !this.state.revoked) r = await send(true); // access token expired mid-push
      } catch (err) {
        await this.admin.localOutboxEntry.update({ where: { id: e.id }, data: { attempts: { increment: 1 }, lastError: err instanceof Error ? err.message : String(err) } });
        throw err;
      }
      if (this.state.revoked) throw new Error('Appareil désactivé, synchronisation arrêtée.');
      const json = (await r.json().catch(() => null)) as { message?: unknown } | null;

      if (r.ok) {
        const pairs = pairIds(e.localResponse, json);
        for (const [localId, remoteId] of pairs) {
          await this.admin.localIdMap.upsert({ where: { localId }, create: { localId, remoteId }, update: { remoteId } });
        }
        await this.admin.localOutboxEntry.update({ where: { id: e.id }, data: { status: 'applied', appliedAt: new Date(), httpStatus: r.status, lastError: null, attempts: { increment: 1 } } });
        applied++;
        continue;
      }
      const message = json?.message ? (Array.isArray(json.message) ? json.message.join(', ') : String(json.message)) : `HTTP ${r.status}`;
      if (r.status >= 500 || r.status === 429) {
        await this.admin.localOutboxEntry.update({ where: { id: e.id }, data: { attempts: { increment: 1 }, lastError: message, httpStatus: r.status } });
        throw new Error(`Le serveur a répondu ${r.status}, nouvel essai plus tard.`);
      }
      // Business rejection (e.g. stock already sold by another poste): the
      // server is authoritative; park it for a human, keep going with the rest.
      await this.admin.localOutboxEntry.update({ where: { id: e.id }, data: { status: 'failed', attempts: { increment: 1 }, lastError: message, httpStatus: r.status } });
    }
    if (applied) this.state.lastPushAt = new Date();
    return applied;
  }

  private async pull(): Promise<void> {
    const r = await this.deviceCall('/api/sync/snapshot', { timeoutMs: 180_000 });
    if (!r.ok) throw new Error(`Instantané refusé (${r.status})`);
    const snapshot = (await r.json()) as Snapshot;
    await this.state.lock.withWrite(async () => {
      // A write recorded while the snapshot was downloading isn't on the
      // server yet: loading now would hide it until the next round.
      if ((await this.admin.localOutboxEntry.count({ where: { status: 'pending' } })) > 0) return;
      await loadSnapshot(this.admin, snapshot);
      this.state.lastPullAt = new Date();
    });
  }

  private async topUpBlocks(): Promise<void> {
    const year = new Date().getFullYear();
    const blocks = await this.admin.numberBlock.findMany({ where: { releasedAt: null, year } });
    for (const counterKey of DEVICE_COUNTER_KEYS) {
      const remaining = blocks.filter((b) => b.counterKey === counterKey).reduce((n, b) => n + (b.end - b.lastUsed), 0);
      if (remaining >= BLOCK_LOW_WATER) continue;
      const r = await this.deviceCall('/api/sync/number-blocks', { method: 'POST', body: JSON.stringify({ counterKey, size: BLOCK_SIZE }) });
      if (!r.ok) throw new Error(`Réservation de numéros refusée (${r.status})`);
      const b = (await r.json()) as Snapshot['numberBlocks'][number];
      await this.admin.numberBlock.create({
        data: { ...b, createdAt: new Date(b.createdAt), releasedAt: null },
      });
    }
  }

  async outbox(status?: string) {
    return this.admin.localOutboxEntry.findMany({
      where: status ? { status } : { status: { in: ['pending', 'failed'] } },
      orderBy: { createdAt: 'desc' },
      take: 300,
      select: { id: true, userId: true, method: true, path: true, status: true, attempts: true, httpStatus: true, lastError: true, createdAt: true, appliedAt: true, body: true },
    });
  }

  async counts() {
    const [pending, failed] = await Promise.all([
      this.admin.localOutboxEntry.count({ where: { status: 'pending' } }),
      this.admin.localOutboxEntry.count({ where: { status: 'failed' } }),
    ]);
    return { pending, failed };
  }

  async retry(id: string) {
    await this.admin.localOutboxEntry.updateMany({ where: { id, status: 'failed' }, data: { status: 'pending', lastError: null } });
    void this.tick();
  }

  async discard(id: string) {
    await this.admin.localOutboxEntry.updateMany({ where: { id, status: { in: ['failed', 'pending'] } }, data: { status: 'discarded' } });
    // The discarded change only exists locally — a fresh pull drops it.
    this.requestPull();
  }
}
