import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { AuditModule } from '../audit/audit.module';
import { LicensingController } from './licensing.controller';
import { LicensingService } from './licensing.service';
import { LicenseTokenService } from './license-token.service';

@Module({
  imports: [TenancyModule, AuditModule],
  controllers: [LicensingController],
  providers: [LicensingService, LicenseTokenService],
  exports: [LicensingService, LicenseTokenService],
})
export class LicensingModule {}
