import { Body, Controller, ForbiddenException, Get, Headers, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { IsString, MaxLength } from 'class-validator';
import { timingSafeEqual } from 'node:crypto';
import { RequiresPermission } from '../modules/tenancy/decorators/requires-permission.decorator';
import { JwtAuthGuard } from '../modules/tenancy/guards/jwt-auth.guard';
import { PermissionGuard } from '../modules/tenancy/guards/permission.guard';
import { localEnv } from './local-env';
import { LocalStateService } from './local-state.service';
import { LocalSyncService } from './local-sync.service';

class SetLicenseDto {
  @IsString()
  @MaxLength(4000)
  licenseToken!: string;
}

function secretMatches(given: string | undefined): boolean {
  const expected = localEnv().controlSecret;
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Device-only endpoints: sync status for the UI, the outbox review page, and the desktop shell's control channel. */
@Controller('local')
export class LocalController {
  constructor(
    private readonly state: LocalStateService,
    private readonly sync: LocalSyncService,
  ) {}

  @Get('status')
  @UseGuards(JwtAuthGuard)
  async status() {
    return {
      mode: 'desktop',
      online: this.state.online,
      syncing: this.state.syncing,
      readOnly: this.state.readOnly,
      revoked: this.state.revoked,
      licenseExpiresAt: this.state.licenseExpiresAt,
      lastPushAt: this.state.lastPushAt,
      lastPullAt: this.state.lastPullAt,
      lastError: this.state.lastError,
      ...(await this.sync.counts()),
    };
  }

  @Post('sync')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(JwtAuthGuard)
  syncNow() {
    this.sync.requestPull();
    return { started: true };
  }

  @Get('outbox')
  @UseGuards(JwtAuthGuard)
  outbox(@Query('status') status?: string) {
    return this.sync.outbox(['pending', 'failed', 'applied', 'discarded'].includes(status ?? '') ? status : undefined);
  }

  @Post('outbox/:id/retry')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async retry(@Param('id') id: string) {
    await this.sync.retry(id);
    return { ok: true };
  }

  // Discarding drops a change made on this poste for good — admins only.
  @Post('outbox/:id/discard')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequiresPermission('licensing', 'licensing.device.manage')
  async discard(@Param('id') id: string) {
    await this.sync.discard(id);
    return { ok: true };
  }

  /** The desktop shell pushes each renewed license here (shared secret, localhost only). */
  @Post('control/license')
  @HttpCode(HttpStatus.OK)
  setLicense(@Headers('x-stockily-control') secret: string | undefined, @Body() dto: SetLicenseDto) {
    if (!secretMatches(secret)) throw new ForbiddenException();
    this.state.setLicense(dto.licenseToken);
    void this.sync.tick();
    return { readOnly: this.state.readOnly, licenseExpiresAt: this.state.licenseExpiresAt };
  }

  @Get('control/ready')
  ready(@Headers('x-stockily-control') secret: string | undefined) {
    if (!secretMatches(secret)) throw new ForbiddenException();
    return { ready: true, deviceId: this.state.deviceId, lastError: this.state.lastError };
  }
}
