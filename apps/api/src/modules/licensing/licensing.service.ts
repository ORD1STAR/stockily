import { ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { runWithTenant, setTenantOnTransaction } from '@org/infra-db';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivateDeviceDto, DeviceFingerprintDto, LicenseTokenDto } from './licensing.dto';
import { compositeFingerprint, LicenseTokenService } from './license-token.service';

export const LICENSE_DAYS = 45;

type Tx = Prisma.TransactionClient;
type DeviceRow = Prisma.DeviceActivationGetPayload<object>;

const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 24 * 60 * 60 * 1000);

/** How many of the three component hashes two fingerprints share. */
export function sharedComponents(a: DeviceFingerprintDto, b: DeviceFingerprintDto): number {
  return (
    Number(a.motherboardHash.toLowerCase() === b.motherboardHash.toLowerCase()) +
    Number(a.diskHash.toLowerCase() === b.diskHash.toLowerCase()) +
    Number(a.macHash.toLowerCase() === b.macHash.toLowerCase())
  );
}

export function deviceView(d: DeviceRow) {
  return {
    id: d.id,
    deviceLabel: d.deviceLabel,
    status: d.status,
    activatedAt: d.activatedAt,
    lastRenewedAt: d.lastRenewedAt,
    licenseExpiresAt: d.licenseExpiresAt,
    deactivatedAt: d.deactivatedAt,
    reactivationCount: d.reactivationCount,
  };
}

@Injectable()
export class LicensingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: LicenseTokenService,
  ) {}

  /** Seat cap = active sites × the org's seatsPerSite. */
  private async seats(tx: Tx, orgId: string) {
    const [org, sites, used] = await Promise.all([
      tx.organization.findUniqueOrThrow({ where: { id: orgId }, select: { seatsPerSite: true } }),
      tx.site.count({ where: { orgId, isActive: true } }),
      tx.deviceActivation.count({ where: { orgId, status: 'active' } }),
    ]);
    return { used, total: Math.max(1, sites) * org.seatsPerSite, seatsPerSite: org.seatsPerSite, sites };
  }

  /** Module keys the org is currently entitled to (active, or a valid unexpired trial). */
  private async activeModuleKeys(orgId: string): Promise<string[]> {
    const rows = await this.prisma.organizationModuleEntitlement.findMany({
      where: { orgId },
      include: { module: { select: { key: true } } },
    });
    return rows
      .filter((e) => e.status === 'active' || (e.status === 'trial' && !!e.trialEndsAt && e.trialEndsAt.getTime() > Date.now()))
      .map((e) => e.module.key);
  }

  private async issue(device: DeviceRow) {
    const ent = await runWithTenant(device.orgId, () => this.activeModuleKeys(device.orgId));
    return {
      licenseToken: this.tokens.sign({ sub: device.id, orgId: device.orgId, fp: device.fingerprintHash, ent }, device.licenseExpiresAt),
      deviceId: device.id,
      expiresAt: device.licenseExpiresAt,
    };
  }

  async activate(orgId: string, dto: ActivateDeviceDto) {
    const fingerprintHash = compositeFingerprint(dto.motherboardHash, dto.diskHash, dto.macHash);
    const now = new Date();
    const licenseExpiresAt = addDays(now, LICENSE_DAYS);

    const result = await this.prisma.$transaction(async (tx) => {
      await setTenantOnTransaction(tx, orgId);
      // Serializes concurrent activations for one org, so two machines
      // racing for the last seat can't both get it.
      await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${orgId} FOR UPDATE`;

      const devices = await tx.deviceActivation.findMany({ where: { orgId } });
      const exact = devices.find((d) => d.fingerprintHash === fingerprintHash);
      // 2-of-3 component match: the same machine after a disk swap or a NIC
      // change keeps its seat instead of burning a new one.
      const fuzzy = exact
        ? undefined
        : devices
            .filter((d) => d.status !== 'revoked' && sharedComponents(d, dto) >= 2)
            .sort((a, b) => b.lastRenewedAt.getTime() - a.lastRenewedAt.getTime())[0];
      const existing = exact ?? fuzzy;

      if (existing?.status === 'revoked') {
        throw new ForbiddenException({
          statusCode: 403,
          error: 'device_revoked',
          message: 'Cet appareil a été révoqué. Contactez le support Stockily pour le réactiver.',
        });
      }

      // A device that isn't currently holding a seat (new, or self-released
      // earlier) needs a free one — an already-active device is just renewed.
      if (existing?.status !== 'active') {
        const seats = await this.seats(tx, orgId);
        if (seats.used >= seats.total) {
          throw new ForbiddenException({
            statusCode: 403,
            error: 'seats_exhausted',
            used: seats.used,
            total: seats.total,
            message: `Aucun poste disponible (${seats.used}/${seats.total} utilisés). Désactivez un appareil depuis Paramètres → Appareils, ou contactez Stockily pour ajouter des postes.`,
          });
        }
      }

      if (existing) {
        const device = await tx.deviceActivation.update({
          where: { id: existing.id },
          data: {
            status: 'active',
            fingerprintHash,
            motherboardHash: dto.motherboardHash,
            diskHash: dto.diskHash,
            macHash: dto.macHash,
            deviceLabel: dto.deviceLabel ?? existing.deviceLabel,
            lastRenewedAt: now,
            licenseExpiresAt,
            deactivatedAt: null,
            reactivationCount: existing.status === 'active' && exact ? existing.reactivationCount : existing.reactivationCount + 1,
          },
        });
        return { device, isNew: false };
      }

      const device = await tx.deviceActivation.create({
        data: {
          orgId,
          fingerprintHash,
          motherboardHash: dto.motherboardHash,
          diskHash: dto.diskHash,
          macHash: dto.macHash,
          deviceLabel: dto.deviceLabel,
          licenseExpiresAt,
        },
      });
      await this.flagActivationBurst(tx, orgId);
      return { device, isNew: true };
    }, { maxWait: 10_000, timeout: 20_000 }); // waits on the org row lock above; Prisma's 2s/5s defaults are too tight under load

    // `id` is what AuditInterceptor records as the audited entity.
    return { id: result.device.id, ...(await this.issue(result.device)), isNewDevice: result.isNew };
  }

  // Cheap anomaly signal for "one license resold to many shops": many brand
  // new machines activating for one org in a day. Flags for review (an
  // audit_log row support can query) — never blocks; the seat cap already
  // bounds concurrent use.
  private async flagActivationBurst(tx: Tx, orgId: string) {
    const [org, recent] = await Promise.all([
      tx.organization.findUniqueOrThrow({ where: { id: orgId }, select: { seatsPerSite: true } }),
      tx.deviceActivation.count({ where: { orgId, activatedAt: { gte: addDays(new Date(), -1) } } }),
    ]);
    if (recent === org.seatsPerSite * 2 + 1) {
      await tx.auditLog.create({
        data: {
          orgId,
          entityType: 'organization',
          entityId: orgId,
          action: 'licensing.anomaly.activation_burst',
          diff: { newDevicesLast24h: recent, seatsPerSite: org.seatsPerSite },
        },
      });
    }
  }

  /**
   * Verifies a license token AND that the caller still presents the same
   * hardware, then returns the live device row. Used by renew/release and
   * by the sync endpoints (device-authenticated, no user session).
   */
  async authenticateDevice(token: string, fingerprint?: DeviceFingerprintDto, opts: { ignoreExpiration?: boolean } = {}) {
    const payload = this.tokens.verify(token, opts);
    const device = await runWithTenant(payload.orgId, () => this.prisma.deviceActivation.findUnique({ where: { id: payload.sub } }));
    if (!device || device.orgId !== payload.orgId) throw new UnauthorizedException({ statusCode: 401, error: 'invalid_license', message: 'Licence inconnue.' });
    if (device.status !== 'active') {
      throw new UnauthorizedException({
        statusCode: 401,
        error: device.status === 'revoked' ? 'device_revoked' : 'device_deactivated',
        message: device.status === 'revoked' ? 'Cet appareil a été révoqué.' : 'Cet appareil a été désactivé — reconnectez-vous pour le réactiver.',
      });
    }
    if (fingerprint && compositeFingerprint(fingerprint.motherboardHash, fingerprint.diskHash, fingerprint.macHash) !== device.fingerprintHash) {
      throw new UnauthorizedException({ statusCode: 401, error: 'fingerprint_mismatch', message: 'Cette licence appartient à un autre ordinateur.' });
    }
    return device;
  }

  async renew(dto: LicenseTokenDto) {
    // A license that lapsed during a long offline stretch can still be
    // renewed — what matters is that the device row is still active.
    const device = await this.authenticateDevice(dto.licenseToken, dto, { ignoreExpiration: true });
    const now = new Date();
    const renewed = await runWithTenant(device.orgId, () =>
      this.prisma.deviceActivation.update({
        where: { id: device.id },
        data: { lastRenewedAt: now, licenseExpiresAt: addDays(now, LICENSE_DAYS) },
      }),
    );
    return this.issue(renewed);
  }

  /** The device frees its own seat (sign-out / uninstall). */
  async release(dto: LicenseTokenDto) {
    const device = await this.authenticateDevice(dto.licenseToken, dto, { ignoreExpiration: true });
    await this.deactivateInternal(device.orgId, device.id);
    return { released: true };
  }

  async listDevices(orgId: string) {
    return this.prisma.$transaction(async (tx) => {
      await setTenantOnTransaction(tx, orgId);
      const [devices, seats] = await Promise.all([
        tx.deviceActivation.findMany({ where: { orgId }, orderBy: [{ status: 'asc' }, { lastRenewedAt: 'desc' }] }),
        this.seats(tx, orgId),
      ]);
      return { seats, devices: devices.map(deviceView) };
    });
  }

  // No cooldown, by explicit product decision: an admin can free and reuse
  // seats as often as they like.
  async deactivate(orgId: string, id: string) {
    const device = await this.deactivateInternal(orgId, id);
    return deviceView(device);
  }

  private async deactivateInternal(orgId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      await setTenantOnTransaction(tx, orgId);
      const device = await tx.deviceActivation.findFirst({ where: { id, orgId } });
      if (!device) throw new NotFoundException('Appareil introuvable.');
      // Its unused reserved numbers are released (kept as documented gaps,
      // never re-issued to another device).
      await tx.numberBlock.updateMany({ where: { orgId, deviceActivationId: id, releasedAt: null }, data: { releasedAt: new Date() } });
      if (device.status !== 'active') return device;
      return tx.deviceActivation.update({ where: { id }, data: { status: 'deactivated', deactivatedAt: new Date() } });
    });
  }
}
