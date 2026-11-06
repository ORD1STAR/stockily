import { PrismaClient } from '@prisma/client';

/**
 * Test helper: gives an org a paid, running module (what a purchase does),
 * straight in the database. Multi-sites is no longer part of the free trial,
 * so specs that create extra sites must grant it first.
 */
export async function grantModule(databaseUrl: string, orgId: string, key: string): Promise<void> {
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  try {
    const module = await db.module.findUniqueOrThrow({ where: { key } });
    await db.organizationModuleEntitlement.upsert({
      where: { orgId_moduleId: { orgId, moduleId: module.id } },
      update: { status: 'active', expiresAt: null, trialEndsAt: null },
      create: { orgId, moduleId: module.id, status: 'active' },
    });
  } finally {
    await db.$disconnect();
  }
}
