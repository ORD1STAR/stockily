import { Global, Module } from '@nestjs/common';
import { PrismaService, createPrismaService } from './prisma.service';

// Global so every feature module (Auth, Tenancy, Stock/Quality/Invoicing, ...)
// can inject PrismaService without each importing this module individually.
//
// Provided via a factory, not `providers: [PrismaService]` (Milestone 1–7's
// shape) — see prisma.service.ts's comment for why: the RLS-extended client
// (Milestone 8) isn't an `instanceof PrismaService`, so Nest can't construct
// it by just calling `new PrismaService()` the default way.
@Global()
@Module({
  providers: [{ provide: PrismaService, useFactory: createPrismaService }],
  exports: [PrismaService],
})
export class PrismaModule {}
