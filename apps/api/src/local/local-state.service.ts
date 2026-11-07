import { Injectable, Logger } from '@nestjs/common';
import { LicensePayload, LicenseTokenService } from '../modules/licensing/license-token.service';
import { setLocalActiveModuleKeys, setLocalEntitlementRefresher } from './local-entitlements';
import { localEnv } from './local-env';
import { RwLock } from './rw-lock';

/** What the device knows about itself right now — shared by the interceptor, the sync engine and /api/local/status. */
@Injectable()
export class LocalStateService {
  readonly lock = new RwLock();
  private license: { token: string; payload: LicensePayload } | null = null;
  online = false;
  revoked: string | null = null;
  lastPushAt: Date | null = null;
  lastPullAt: Date | null = null;
  lastError: string | null = null;
  syncing = false;

  private readonly logger = new Logger(LocalStateService.name);
  private refreshing: Promise<boolean> | null = null;
  private lastRefreshAt = 0;
  private readonly renewedListeners: (() => void)[] = [];

  constructor(private readonly tokens: LicenseTokenService) {
    const token = localEnv().licenseToken;
    if (token) this.setLicense(token);
    setLocalEntitlementRefresher(() => this.refreshOnline());
  }

  /** Called whenever a renewed license has been loaded (the sync engine pulls fresh data then). */
  onRenewed(fn: () => void) {
    this.renewedListeners.push(fn);
  }

  /**
   * Renews the signed license against the server right now, so a module bought
   * online is usable without waiting for the shell's periodic renewal. Called
   * before a module is refused. Concurrent calls share one request, and at most
   * one real attempt is made every 15 s. False = nothing changed (offline, refused, throttled).
   */
  refreshOnline(minGapMs = 15_000): Promise<boolean> {
    if (this.refreshing) return this.refreshing;
    if (Date.now() - this.lastRefreshAt < minGapMs) return Promise.resolve(false);
    this.lastRefreshAt = Date.now();
    this.refreshing = this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<boolean> {
    const fp = localEnv().fingerprint;
    if (!fp || !this.license) return false;
    try {
      const r = await fetch(`${localEnv().remoteOrigin}/api/licensing/renew`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...fp, licenseToken: this.license.token }),
        signal: AbortSignal.timeout(6_000),
      });
      if (!r.ok) return false;
      const { licenseToken } = (await r.json()) as { licenseToken?: string };
      if (!licenseToken) return false;
      this.setLicense(licenseToken);
      this.renewedListeners.forEach((fn) => fn());
      return true;
    } catch (err) {
      this.logger.debug(`Online license refresh failed: ${err instanceof Error ? err.message : err}`);
      return false;
    }
  }

  /** The desktop shell hands over each renewed license; the signature is re-checked here, not just trusted. */
  setLicense(token: string) {
    const payload = this.tokens.verify(token, { ignoreExpiration: true });
    this.license = { token, payload };
    this.revoked = null;
    // Entitlements now come from the signed token, not the local DB.
    setLocalActiveModuleKeys(payload.ent ?? null);
  }

  get licenseToken(): string {
    return this.license?.token ?? '';
  }

  get deviceId(): string {
    return this.license?.payload.sub ?? '';
  }

  get orgId(): string {
    return this.license?.payload.orgId ?? '';
  }

  get licenseExpiresAt(): Date | null {
    const exp = this.license?.payload.exp;
    return exp ? new Date(exp * 1000) : null;
  }

  /** 45 days without renewal (or no/revoked license): consultation and printing only. */
  get readOnly(): boolean {
    const exp = this.licenseExpiresAt;
    return !this.license || !!this.revoked || !exp || exp.getTime() < Date.now();
  }
}
