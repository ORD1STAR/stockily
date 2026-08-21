import { PrismaClient } from '@prisma/client';

// Thin wrapper around the generated Prisma client. Concrete repository
// implementations (satisfying interfaces defined in the domain-* packages —
// see docs/Action Plan.md §6) land here as this fills out; the domain layer
// never imports this package directly, only the reverse.
export function createPrismaClient(): PrismaClient {
  return new PrismaClient();
}
