import { getLocalActiveModuleKeys } from './local-entitlements';
import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { timingSafeEqual } from 'node:crypto';
import { RequiresPermission } from '../modules/tenancy/decorators/requires-permission.decorator';
import { JwtAuthGuard } from '../modules/tenancy/guards/jwt-auth.guard';
import { PermissionGuard } from '../modules/tenancy/guards/permission.guard';
import { localEnv } from './local-env';
import { LocalStateService } from './local-state.service';
import { LocalUpdateService, UpdateState } from './local-update.service';
import { LocalSyncService } from './local-sync.service';

class SetLicenseDto {
  @IsString()
  @MaxLength(4000)
  licenseToken!: string;
}

class OpenExternalDto {
  @IsString()
  @MaxLength(2000)
  url!: string;
}

class UpdateStatusDto {
  @IsIn(['idle', 'checking', 'uptodate', 'available', 'downloading', 'error'])
  phase!: UpdateState['phase'];

  @IsOptional() @IsString() @MaxLength(40) version?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsInt() @Min(0) downloaded?: number;
  @IsOptional() @IsInt() @Min(0) total?: number;
  @IsOptional() @IsString() @MaxLength(500) error?: string;
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
    private readonly updates: LocalUpdateService,
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
      // Modules in the signed license: lets the UI notice when one was added (bought online).
      modules: [...(getLocalActiveModuleKeys() ?? [])].sort(),
      lastPushAt: this.state.lastPushAt,
      lastPullAt: this.state.lastPullAt,
      lastError: this.state.lastError,
      ...(await this.sync.counts()),
    };
  }

  // App updates: the web UI asks, the desktop shell (which owns the updater) does the work.
  @Get('update')
  @UseGuards(JwtAuthGuard)
  updateState(): UpdateState {
    return this.updates.get();
  }

  @Post('update/check')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(JwtAuthGuard)
  checkUpdate(): UpdateState {
    return this.updates.ask('check');
  }

  @Post('update/install')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(JwtAuthGuard)
  installUpdate(): UpdateState {
    return this.updates.ask('install');
  }

  /**
   * Opens a page in the user's own browser (the webview is not a browser). Only https pages of
   * Stockily's server or Chargily's hosted payment page: this is how an in-app purchase is paid.
   */
  @Post('open-external')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(JwtAuthGuard)
  openExternal(@Body() dto: OpenExternalDto) {
    let url: URL;
    try {
      url = new URL(dto.url);
    } catch {
      throw new BadRequestException('Adresse invalide.');
    }
    // Chargily's hosted payment page (its hosts vary by environment) and Stockily's own server.
    const allowed = new Set(['pay.chargily.dz', 'pay.chargily.net', 'pay.chargily.com', new URL(localEnv().remoteOrigin).hostname]);
    if (!allowed.has(url.hostname) || !['https:', 'http:'].includes(url.protocol)) throw new BadRequestException('Cette adresse ne peut pas être ouverte.');
    url.protocol = 'https:'; // Chargily may hand out http:// links; the page is served over https
    this.updates.queueOpen(url.toString());
    return { opened: true };
  }

  /** Looks for modules bought online right now (the purchase dialog calls this while waiting for the payment). */
  @Post('license/refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async refreshLicense() {
    await this.state.refreshOnline(4_000);
    return { modules: [...(getLocalActiveModuleKeys() ?? [])].sort() };
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

  /** The shell polls this for a request made from the UI. */
  @Get('control/update-request')
  updateRequest(@Headers('x-stockily-control') secret: string | undefined) {
    if (!secretMatches(secret)) throw new ForbiddenException();
    return { request: this.updates.take(), openUrl: this.updates.takeOpen() };
  }

  @Post('control/update-status')
  @HttpCode(HttpStatus.OK)
  updateStatus(@Headers('x-stockily-control') secret: string | undefined, @Body() dto: UpdateStatusDto) {
    if (!secretMatches(secret)) throw new ForbiddenException();
    return this.updates.report(dto);
  }

  @Get('control/ready')
  ready(@Headers('x-stockily-control') secret: string | undefined) {
    if (!secretMatches(secret)) throw new ForbiddenException();
    return { ready: true, deviceId: this.state.deviceId, lastError: this.state.lastError };
  }
}
