import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TenancyModule } from '../tenancy/tenancy.module';
import { AuditModule } from '../audit/audit.module';

// JwtService comes from the globally-registered JwtConfigModule
// (apps/api/src/config/jwt-config.module.ts) — not imported here directly,
// since TenancyModule's JwtAuthGuard needs the exact same configured
// instance and importing/configuring JwtModule twice would risk drift.
@Module({
  imports: [TenancyModule, AuditModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
