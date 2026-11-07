import { Injectable } from '@nestjs/common';

export type UpdatePhase = 'idle' | 'checking' | 'uptodate' | 'available' | 'downloading' | 'error';

export interface UpdateState {
  phase: UpdatePhase;
  /** Version of the installed app (from the shell). */
  current: string;
  /** Newest version found on the server, when there is one. */
  version?: string;
  notes?: string;
  downloaded?: number;
  total?: number;
  error?: string;
  checkedAt?: string;
}

type UpdateRequest = 'check' | 'install';

/**
 * The app update runs in the desktop shell (it owns the updater and the
 * installer), not in this API. This is the mailbox between the two over the
 * localhost control channel: the web UI posts a request, the shell polls for it,
 * does the work and posts progress back; the UI reads the state.
 * If the shell stops answering, the request is reported as failed instead of hanging.
 */
@Injectable()
export class LocalUpdateService {
  private state: UpdateState = { phase: 'idle', current: process.env.STOCKILY_APP_VERSION ?? '' };
  private request: UpdateRequest | null = null;
  private touchedAt = 0;
  private readonly openQueue: string[] = [];

  /** Seconds the shell may stay silent before the request is considered lost. */
  private static readonly SILENCE_MS = 30_000;

  get(): UpdateState {
    const busy = this.state.phase === 'checking' || this.state.phase === 'downloading';
    if (busy && Date.now() - this.touchedAt > LocalUpdateService.SILENCE_MS) {
      this.request = null;
      this.state = { ...this.state, phase: 'error', error: 'Le gestionnaire de mises à jour ne répond pas. Fermez puis rouvrez Stockily : la recherche se fera au démarrage.' };
    }
    return this.state;
  }

  /** A person asked: look for an update, or install the one that was found. */
  ask(request: UpdateRequest): UpdateState {
    const s = this.get();
    if (s.phase === 'checking' || s.phase === 'downloading') return s;
    if (request === 'install' && s.phase !== 'available') return s;
    this.request = request;
    this.touchedAt = Date.now();
    this.state = request === 'check'
      ? { phase: 'checking', current: s.current }
      : { ...s, phase: 'downloading', downloaded: 0, total: undefined, error: undefined };
    return this.state;
  }

  /** The shell collects the pending request (once). */
  take(): UpdateRequest | null {
    const r = this.request;
    this.request = null;
    return r;
  }

  /** A page to open in the system browser (e.g. the payment page); the shell collects it. */
  queueOpen(url: string) {
    this.openQueue.push(url);
    if (this.openQueue.length > 5) this.openQueue.shift();
  }

  takeOpen(): string | null {
    return this.openQueue.shift() ?? null;
  }

  /** The shell reports where it is. */
  report(patch: Partial<UpdateState>): UpdateState {
    this.touchedAt = Date.now();
    const keep = { current: this.state.current };
    this.state = { ...this.state, ...patch, ...keep, ...(patch.phase === 'uptodate' || patch.phase === 'available' || patch.phase === 'error' ? { checkedAt: new Date().toISOString() } : {}) };
    if (patch.phase === 'uptodate' || patch.phase === 'error') {
      delete this.state.version;
      delete this.state.notes;
    }
    return this.state;
  }
}
