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
//   - Phase 2/3 module dependencies for the still-unbuilt ones
//     (delivery->sales, returns->stock+invoicing, accounting->invoicing)
//     are provisional stubs for a registry that needs *some* value, not
//     binding designs — those modules are not built yet. purchasing/sales
//     themselves are real, built dependencies (Milestone 9/10) — both
//     require invoicing (the facture step), purchasing additionally
//     requires stock (it deducts nothing without it), sales does not (a
//     services-only line has no product to reserve).
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

  // Milestone 10 — purchasing now also needs invoicing (facture
  // fournisseur orchestration, see PurchasingService.createSupplierInvoice).
  { key: 'purchasing', name: 'Gestion Achats', phase: 2, dependencies: ['stock', 'invoicing'] },
  // Milestone 10 — repurposes the 'orders' stub (never built, unreferenced
  // anywhere): Gestion Ventes is broader than just "Commandes Clients"
  // (devis + commande + facture client), doesn't require Stock (a
  // services-only line has no product to reserve), but does require
  // Invoicing for the facture step — symmetric to purchasing above.
  { key: 'sales', name: 'Gestion Ventes', phase: 2, dependencies: ['invoicing'] },
  { key: 'delivery', name: 'Livraisons & Transport', phase: 2, dependencies: ['sales'] },
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
    'stock.product.delete',
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
    'invoicing.invoice.finalize',
    'invoicing.invoice.void',
    'invoicing.invoice.delete',
    'invoicing.payment.create',
    'invoicing.partner.read',
    'invoicing.partner.write',
    'invoicing.partner.delete',
    'invoicing.taxrate.read',
    'invoicing.taxrate.write',
    // Business-legal-profile fields (name/address/NIF/NIS/RC/tax article)
    // required before a CUSTOMER invoice can be finalized — see
    // InvoicingService.finalizeInvoice and docs/MILESTONE_4.md.
    'invoicing.profile.read',
    'invoicing.profile.write',
    'invoicing.reminder.run',
  ],
  sites: ['sites.site.read', 'sites.site.write', 'sites.transfer.create', 'sites.transfer.read', 'sites.transfer.update'],
  scan: ['scan.label.generate', 'scan.label.print', 'scan.label.read', 'scan.resolve.read'],
  // Milestone 9 (Achats/Purchasing) — the first Phase 2 module built. Kept
  // in the same ACTIONS map as the 5 Phase 1 ones (the seeding loop below
  // iterates Object.keys(ACTIONS) generically, no special-casing needed);
  // `purchasing` was already seeded into MODULES above since Milestone 1,
  // this is what actually grants a role permission to use it.
  purchasing: [
    'purchasing.order.create',
    'purchasing.order.read',
    'purchasing.order.update',
    'purchasing.order.cancel',
    'purchasing.order.delete',
    'purchasing.orderline.delete',
    'purchasing.receipt.create',
    'purchasing.receipt.read',
    // Milestone 10
    'purchasing.rfq.create',
    'purchasing.rfq.award',
    'purchasing.invoice.create',
    'purchasing.dashboard.read',
  ],
  // Milestone 10 (Gestion Ventes) — the customer-side mirror of purchasing.
  // sales.order.* covers both devis and commande (kind is a DTO field, not
  // a separate permission) — see CreateSalesOrderDto's own doc.
  sales: [
    'sales.order.create',
    'sales.order.read',
    'sales.order.update',
    'sales.order.cancel',
    'sales.order.delete',
    'sales.orderline.delete',
    'sales.invoice.create',
    'sales.pricing.read',
    'sales.pricing.write',
    'sales.dashboard.read',
  ],
};

// Every action across every module this seed script grants permissions
// for — not just Phase 1 anymore since Milestone 9 added `purchasing` above
// (Super Admin/Gestionnaire get every built module's actions regardless of
// phase, same as they always have for Phase 1).
const ALL_BUILT_MODULE_ACTIONS = Object.values(ACTIONS).flat();
const READ_ONLY = (keys: string[]) =>
  keys.flatMap((k) => ACTIONS[k].filter((a) => a.endsWith('.read')));

const ROLES: { name: string; actions: string[] }[] = [
  { name: 'Super Admin', actions: ALL_BUILT_MODULE_ACTIONS },
  { name: 'Gestionnaire', actions: ALL_BUILT_MODULE_ACTIONS },
  {
    name: 'Opérateur Entrepôt',
    actions: [
      ...ACTIONS.stock,
      ...ACTIONS.quality,
      ...ACTIONS.scan,
      ...READ_ONLY(['purchasing']),
      'purchasing.receipt.create',
      // Milestone 10 — sees what's been commandé (picking visibility),
      // doesn't create/manage sales orders themselves.
      ...READ_ONLY(['sales']),
    ],
  },
  {
    name: 'Commercial',
    // Milestone 10 — this is squarely the sales-rep role: full sales.*,
    // plus the existing read-only visibility into stock/invoicing.
    actions: [...ACTIONS.sales, ...READ_ONLY(['stock', 'invoicing'])],
  },
  {
    name: 'Comptable / Finance',
    // Milestone 10 — finance visibility on both sides of the ledger now
    // that purchasing/sales exist, in addition to the existing full
    // invoicing set.
    actions: [...ACTIONS.invoicing, ...READ_ONLY(['stock', 'quality', 'purchasing', 'sales'])],
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

  // Milestone 10 — 'orders' was renamed to 'sales' above (upsert-by-key
  // creates a new row rather than renaming in place); the old row is
  // confirmed unreferenced anywhere (no OrganizationModuleEntitlement, no
  // RolePermission — Milestone 9's exploration pass grepped the whole
  // codebase for it) so it's safe to remove rather than leave orphaned.
  await prisma.module.deleteMany({ where: { key: 'orders' } });

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
