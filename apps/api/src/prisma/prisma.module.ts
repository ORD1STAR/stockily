import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// Global so every feature module (Auth, Tenancy, and Stock/Quality/Invoicing
// in later milestones) can inject PrismaService without each importing this
// module individually.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
