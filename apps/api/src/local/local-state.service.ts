import { Injectable } from '@nestjs/common';
import { LicensePayload, LicenseTokenService } from '../modules/licensing/license-token.service';
import { setLocalActiveModuleKeys } from './local-entitlements';
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

  constructor(private readonly tokens: LicenseTokenService) {
    const token = localEnv().licenseToken;
    if (token) this.setLicense(token);
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
