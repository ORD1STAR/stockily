import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Req, UseGuards } from '@nestjs/common';
import { CurrentUser, AuthenticatedUser } from '../tenancy/decorators/current-user.decorator';
import { RequiresPermission } from '../tenancy/decorators/requires-permission.decorator';
import { JwtAuthGuard } from '../tenancy/guards/jwt-auth.guard';
import { PermissionGuard } from '../tenancy/guards/permission.guard';
import { AuthenticatedDevice, DeviceAuthGuard } from './device-auth.guard';
import { DeviceSessionDto, ReserveBlockDto } from './sync.dto';
import { SyncService } from './sync.service';

type DeviceRequest = { device: AuthenticatedDevice };

// Called by a desktop device's background sync (license-authenticated),
// except /sync/replays, which is the org admin's view of what devices
// pushed and what failed to apply.
@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  /** Cheap reachability probe for devices deciding whether they're online. */
  @Get('ping')
  ping() {
    return { ok: true, at: new Date().toISOString() };
  }

  @Post('session')
  @HttpCode(HttpStatus.OK)
  @UseGuards(DeviceAuthGuard)
  session(@Req() req: DeviceRequest, @Body() dto: DeviceSessionDto) {
    return this.sync.session(req.device, dto.userId);
  }

  @Get('snapshot')
  @UseGuards(DeviceAuthGuard)
  snapshot(@Req() req: DeviceRequest) {
    return this.sync.snapshot(req.device);
  }

  @Post('number-blocks')
  @UseGuards(DeviceAuthGuard)
  reserve(@Req() req: DeviceRequest, @Body() dto: ReserveBlockDto) {
    return this.sync.reserveBlock(req.device, dto.counterKey, dto.size);
  }

  @Get('replays')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequiresPermission('licensing', 'licensing.device.manage')
  replays(@CurrentUser() user: AuthenticatedUser, @Query('status') status?: string) {
    return this.sync.replays(user.orgId, status === 'failed' || status === 'applied' ? status : undefined);
  }
}
