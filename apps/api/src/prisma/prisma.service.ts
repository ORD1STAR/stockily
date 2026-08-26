import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { withTenantRls } from '@org/infra-db';

// The Nest-specific wiring on top of infra-db's framework-agnostic pieces
// (Action Plan §6): connects/disconnects a real PrismaClient and applies
// the RLS tenant-scoping extension (Milestone 8) to it.
//
// `PrismaService` stays a real class — purely for its TYPE shape (every
// model delegate, `$transaction`, etc., via `extends PrismaClient`) and as
// the DI token every existing consumer already injects by constructor-
// parameter type (`private readonly prisma: PrismaService`, no `@Inject`
// needed — Nest resolves it from reflected `design:paramtypes` metadata,
// which requires the class to exist as a real runtime value, not just a
// type). It is *not* what actually gets instantiated, though: `$extends()`
// returns a structurally-compatible but distinct object, not an
// `instanceof PrismaService` — so `prisma.module.ts` provides this token
// via a factory (`createPrismaService`) instead of `new PrismaService()`.
// Nest calls lifecycle hooks by duck-typing the resolved instance (does it
// have an `onModuleInit`/`onModuleDestroy` method?), not by checking
// `instanceof`, so attaching them via `Object.assign` on the factory's
// returned object still works correctly — verified by this milestone's
// full app boot + e2e suite, not assumed.
export class PrismaService extends PrismaClient {}

const logger = new Logger(PrismaService.name);

export function createPrismaService(): PrismaService & OnModuleInit & OnModuleDestroy {
  // The running API always connects as the restricted `stockily_app` role
  // (Milestone 8) — RLS policies are unconditionally bypassed for a
  // Postgres superuser/BYPASSRLS role, which `DATABASE_URL`'s `stockily`
  // user is (migrations/seed scripts need that privilege). Falls back to
  // `DATABASE_URL` only so an environment that hasn't set the new var yet
  // still boots (against the same DB, just without RLS actually being
  // enforced for it) rather than crashing outright — set APP_DATABASE_URL
  // for real, don't rely on this fallback.
  const datasourceUrl = process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL;
  const client = new PrismaClient({ datasourceUrl });
  const extended = withTenantRls(client);

  return Object.assign(extended, {
    async onModuleInit() {
      await client.$connect();
      logger.log('Connected to database');
    },
    async onModuleDestroy() {
      await client.$disconnect();
      logger.log('Disconnected from database');
    },
  }) as unknown as PrismaService & OnModuleInit & OnModuleDestroy;
}
