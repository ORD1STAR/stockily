import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { AuditModule } from '../audit/audit.module';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';

// Org owners/admins create and manage their organisation's sub-users.
@Module({
  imports: [TenancyModule, AuditModule],
  controllers: [MembersController],
  providers: [MembersService],
})
export class MembersModule {}
