import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { LicensingModule } from '../licensing/licensing.module';
import { DeviceAuthGuard } from './device-auth.guard';
import { ReplayMiddleware } from './replay.middleware';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

@Module({
  imports: [TenancyModule, LicensingModule],
  controllers: [SyncController],
  providers: [SyncService, DeviceAuthGuard, ReplayMiddleware],
  exports: [ReplayMiddleware, LicensingModule],
})
export class SyncModule {}
