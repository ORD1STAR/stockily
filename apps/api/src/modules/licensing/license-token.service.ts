import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'node:crypto';
import { licenseKeys } from './license-keys';

export const LICENSE_TOKEN_TYPE = 'stockily-license';
export const LICENSE_HEADER = 'x-stockily-license';

export interface LicensePayload {
  /** DeviceActivation id. */
  sub: string;
  orgId: string;
  /** Composite fingerprint hash — lets the desktop shell check, offline, that the license belongs to this exact machine. */
  fp: string;
  /**
   * Module keys the org is entitled to at signing time. Signed (RS256), so
   * a desktop device trusts THIS list offline instead of its local DB — a
   * cracker editing `organization_module_entitlements` locally therefore
   * unlocks nothing. Updated entitlements reach a device at its next renew.
   */
  ent?: string[];
  typ: typeof LICENSE_TOKEN_TYPE;
  exp?: number;
}

/** Canonical order matters: the desktop shell recomputes this exact string. */
export function compositeFingerprint(motherboardHash: string, diskHash: string, macHash: string): string {
  return createHash('sha256').update(`${motherboardHash.toLowerCase()}|${diskHash.toLowerCase()}|${macHash.toLowerCase()}`).digest('hex');
}

// Reuses the globally-registered JwtService with per-call RS256 overrides
// instead of registering a second JwtModule: the global one is HS256 for
// access tokens (jwt-config.module.ts), and a license has to be verifiable
// offline by a device that must never hold a server secret — hence an
// asymmetric pair, the private half only ever on the server.
@Injectable()
export class LicenseTokenService {
  constructor(private readonly jwt: JwtService) {}

  sign(payload: Omit<LicensePayload, 'typ' | 'exp'>, expiresAt: Date): string {
    const { privateKey } = licenseKeys();
    if (!privateKey) throw new Error('This instance cannot issue licenses (no LICENSE_PRIVATE_KEY).');
    return this.jwt.sign(
      { ...payload, typ: LICENSE_TOKEN_TYPE },
      // Passed as `secret`, not `privateKey`: @nestjs/jwt resolves the
      // global HS256 secret before a per-call privateKey/publicKey, so the
      // per-call `secret` is the only override that actually wins.
      { algorithm: 'RS256', secret: privateKey, expiresIn: Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000)) },
    );
  }

  /** Throws 401 on a bad signature or wrong token type; `ignoreExpiration` is for renewal of a license that lapsed while offline. */
  verify(token: string, opts: { ignoreExpiration?: boolean } = {}): LicensePayload {
    try {
      const payload = this.jwt.verify<LicensePayload>(token, {
        algorithms: ['RS256'],
        secret: licenseKeys().publicKey,
        ignoreExpiration: opts.ignoreExpiration ?? false,
      });
      if (payload.typ !== LICENSE_TOKEN_TYPE) throw new Error('wrong token type');
      return payload;
    } catch {
      throw new UnauthorizedException({ statusCode: 401, error: 'invalid_license', message: 'Licence invalide ou expirée.' });
    }
  }
}
