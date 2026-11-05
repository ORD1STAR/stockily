import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, AuthenticatedUser } from '../tenancy/decorators/current-user.decorator';
import { RequiresPermission } from '../tenancy/decorators/requires-permission.decorator';
import { JwtAuthGuard } from '../tenancy/guards/jwt-auth.guard';
import { PermissionGuard } from '../tenancy/guards/permission.guard';
import { Audit } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { ActivateDeviceDto, LicenseTokenDto } from './licensing.dto';
import { LicensingService } from './licensing.service';

// Desktop-app device licensing. Deliberately NOT behind
// ModuleEntitlementGuard/@RequiresModule: licensing is infrastructure, not a
// subscribable module — every org can always license and manage its devices.
//  - activate: any signed-in org user, for the machine they're on.
//  - renew/release: authenticated by the license token itself (+ the same
//    hardware fingerprint) — the desktop shell calls them in the background
//    with no user session.
//  - devices / deactivate: org admins (licensing.device.manage).
@Controller('licensing')
export class LicensingController {
  constructor(private readonly licensing: LicensingService) {}

  @Post('activate')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(AuditInterceptor)
  @Audit('device_activation', 'licensing.device.activated')
  activate(@CurrentUser() user: AuthenticatedUser, @Body() dto: ActivateDeviceDto) {
    return this.licensing.activate(user.orgId, dto);
  }

  @Post('renew')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  renew(@Body() dto: LicenseTokenDto) {
    return this.licensing.renew(dto);
  }

  @Post('release')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  release(@Body() dto: LicenseTokenDto) {
    return this.licensing.release(dto);
  }

  @Get('devices')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequiresPermission('licensing', 'licensing.device.manage')
  devices(@CurrentUser() user: AuthenticatedUser) {
    return this.licensing.listDevices(user.orgId);
  }

  @Post('devices/:id/deactivate')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequiresPermission('licensing', 'licensing.device.manage')
  @UseInterceptors(AuditInterceptor)
  @Audit('device_activation', 'licensing.device.deactivated')
  deactivate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.licensing.deactivate(user.orgId, id);
  }
}
