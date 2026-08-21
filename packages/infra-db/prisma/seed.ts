// Seeds the module registry, system roles, and default role permissions.
// Authoritative source: docs/Action Plan.md §1 (all 13 modules), §2 (system
// roles), §4 (module dependency rules: Quality requires Stock, Invoicing
// does not). Run via `npm run db:seed`.
//
// Decisions made here that the Action Plan did not pin down (flagged for
// review, not silently assumed):
//   - Scan is given a dependency on Stock. The plan only states this
//     explicitly for Quality, but Scan's own design (§3: "a scan just calls
//     the existing POST /stock-movements") makes it equally meaningless
//     without Stock, so the same rule is applied by extension.
//   - Phase 2/3 module dependencies (purchasing->stock, orders->stock,
//     delivery->orders, returns->stock+invoicing, accounting->invoicing)
//     are provisional stubs for a registry that needs *some* value, not
//     binding designs — those modules are not built yet.
//   - Super Admin and Gestionnaire end up with an identical
//     RolePermission set on the 5 Phase 1 modules. What actually
//     distinguishes them (subscription/module-activation/user management)
//     is an org-administration concern that has no corresponding "module"
//     in the 13-module registry, so it isn't representable as a
//     RolePermission row. Milestone 1 encodes that distinction as a direct
//     `role.name === 'Super Admin'` check in the relevant service code
//     rather than inventing a pseudo-module — revisit if this needs to
//     become more granular later.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const MODULES = [
  { key: 'stock', name: 'Gestion de Stock', phase: 1, dependencies: [] as string[] },
  { key: 'quality', name: 'Qualité', phase: 1, dependencies: ['stock'] },
  { key: 'invoicing', name: 'Factures', phase: 1, dependencies: [] },
  { key: 'sites', name: 'Multi-Entrepôts / Multi-Sites', phase: 1, dependencies: [] },
  { key: 'scan', name: 'Codes-barres / QR / Scan mobile', phase: 1, dependencies: ['stock'] },

  { key: 'purchasing', name: 'Achats & Fournisseurs', phase: 2, dependencies: ['stock'] },
  { key: 'orders', name: 'Commandes Clients', phase: 2, dependencies: ['stock'] },
  { key: 'delivery', name: 'Livraisons & Transport', phase: 2, dependencies: ['orders'] },
  { key: 'crm', name: 'CRM / Gestion des Clients', phase: 2, dependencies: [] },
  { key: 'notifications', name: 'Notifications & Alertes', phase: 2, dependencies: [] },

  { key: 'returns', name: 'Retours / SAV (RMA)', phase: 3, dependencies: ['stock', 'invoicing'] },
  { key: 'accounting', name: 'Comptabilité Générale', phase: 3, dependencies: ['invoicing'] },
  { key: 'reporting', name: 'Rapports & Analytics', phase: 3, dependencies: [] },
];

// <module>.<resource>.<verb> — matches the plan's own example
// (stock.movement.create, invoice.void was the plan's shorthand; here it's
// invoicing.invoice.void to stay consistent with the module key).
const ACTIONS: Record<string, string[]> = {
  stock: [
    'stock.product.read',
    'stock.product.write',
    'stock.movement.create',
    'stock.movement.read',
    'stock.inventory.adjust',
  ],
  quality: [
    'quality.batch.read',
    'quality.batch.write',
    'quality.check.create',
    'quality.nonconformity.read',
    'quality.nonconformity.resolve',
  ],
  invoicing: [
    'invoicing.invoice.read',
    'invoicing.invoice.create',
    'invoicing.invoice.void',
    'invoicing.payment.create',
  ],
  sites: ['sites.site.read', 'sites.site.write', 'sites.transfer.create'],
  scan: ['scan.label.generate', 'scan.label.print'],
};

const ALL_PHASE1_ACTIONS = Object.values(ACTIONS).flat();
const READ_ONLY = (keys: string[]) =>
  keys.flatMap((k) => ACTIONS[k].filter((a) => a.endsWith('.read')));

const ROLES: { name: string; actions: string[] }[] = [
  { name: 'Super Admin', actions: ALL_PHASE1_ACTIONS },
  { name: 'Gestionnaire', actions: ALL_PHASE1_ACTIONS },
  {
    name: 'Opérateur Entrepôt',
    actions: [...ACTIONS.stock, ...ACTIONS.quality, ...ACTIONS.scan],
  },
  { name: 'Commercial', actions: READ_ONLY(['stock', 'invoicing']) },
  {
    name: 'Comptable / Finance',
    actions: [...ACTIONS.invoicing, ...READ_ONLY(['stock', 'quality'])],
  },
];

async function main() {
  console.log('Seeding modules...');
  for (const m of MODULES) {
    await prisma.module.upsert({
      where: { key: m.key },
      update: { name: m.name, phase: m.phase, dependencies: m.dependencies },
      create: m,
    });
  }

  console.log('Seeding system roles + permissions...');
  for (const r of ROLES) {
    const existing = await prisma.role.findFirst({ where: { name: r.name, isSystem: true } });
    const role =
      existing ?? (await prisma.role.create({ data: { name: r.name, isSystem: true, orgId: null } }));

    for (const moduleKey of Object.keys(ACTIONS)) {
      const module = await prisma.module.findUniqueOrThrow({ where: { key: moduleKey } });
      const actionsForThisModule = r.actions.filter((a) => a.startsWith(`${moduleKey}.`));
      for (const action of actionsForThisModule) {
        await prisma.rolePermission.upsert({
          where: { roleId_moduleId_action: { roleId: role.id, moduleId: module.id, action } },
          update: {},
          create: { roleId: role.id, moduleId: module.id, action },
        });
      }
    }
  }

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
