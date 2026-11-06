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
//   - Cash (Caisse) and Stats were built (cash/counters/inventory/stats/
//     trade modules) reusing other modules' entitlement keys instead of
//     getting their own: Cash was gated behind 'invoicing' even though its
//     ledger stands on its own (CashEntry rows need nothing else), and
//     Stats had no @RequiresModule at all — so entitlement never actually
//     gated it server-side, only the (wrong) frontend nav key pretended it
//     needed 'invoicing'. Both are registered here as independent modules
//     with no dependencies, matching the explicit requirement that Caisse
//     must work standalone, not piggyback on Invoicing. Counters and
//     Inventory stay bundled under 'scan'/'stock' respectively — that one
//     really is intentional (see each controller's own header comment),
//     not the same bug.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const MODULES = [
  { key: 'stock', name: 'Gestion de Stock', phase: 1, dependencies: [] as string[] },
  { key: 'quality', name: 'Qualité', phase: 1, dependencies: ['stock'] },
  { key: 'invoicing', name: 'Factures', phase: 1, dependencies: [] },
  { key: 'sites', name: 'Multi-Entrepôts / Multi-Sites', phase: 1, dependencies: [] },
  { key: 'scan', name: 'Codes-barres / QR / Scan mobile', phase: 1, dependencies: ['stock'] },

  // Caisse: encaissements/décaissements, with or without anything else
  // active (manual CashEntry rows need no other module; it additionally
  // surfaces payments from Invoicing/Achats/Ventes/Comptoirs when those
  // are active, but never requires them).
  { key: 'cash', name: 'Caisse', phase: 2, dependencies: [] },
  // Statistiques: read-only figures over whichever of Stock/Achats/
  // Ventes/Factures/Caisse happen to be active — degrades to empty
  // sections rather than requiring any one of them.
  { key: 'stats', name: 'Statistiques', phase: 2, dependencies: [] },

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

  // Not a subscribable product module — infrastructure for the offline
  // desktop app's device-seat management. Registered here only so
  // RolePermission (which FKs to Module) has a row to point at for
  // 'licensing.device.manage'; no org ever gets an
  // OrganizationModuleEntitlement for it, and LicensingController never
  // declares @RequiresModule('licensing') — every org can always manage its
  // own devices, gated by role (see ACTIONS.licensing) not entitlement.
  { key: 'licensing', name: 'Licences & appareils', phase: 0, dependencies: [] },
  // Also infrastructure, not subscribable: managing the org's own sub-users
  // (members). Gated by role, not entitlement.
  { key: 'members', name: 'Utilisateurs', phase: 0, dependencies: [] },
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
  scan: [
    'scan.label.generate',
    'scan.label.print',
    'scan.label.read',
    'scan.resolve.read',
    // Comptoirs (counters) — split so a till operator can sell without
    // being able to create counters, move cash or print Z tickets.
    'scan.counter.read',
    'scan.counter.create',
    'scan.counter.session',
    'scan.counter.sell',
    'scan.counter.cash',
    'scan.counter.ticket',
  ],
  // Caisse — journal/open-documents read vs. recording/cancelling a
  // movement, the same two-permission split CashController already used
  // under the borrowed 'invoicing' key.
  // encaisser / décaisser / annuler are separate so a till can collect
  // without being able to pay out.
  cash: ['cash.journal.read', 'cash.entry.collect', 'cash.entry.disburse', 'cash.entry.cancel'],
  stats: ['stats.overview.read'],
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
  // Offline desktop app's device-seat management — listing/deactivating
  // OTHER users' devices. Activating/renewing/deactivating your OWN device
  // needs no permission at all (LicensingController gates those by
  // JwtAuthGuard only, same as any self-service action) — this one action
  // is for an admin managing the org's seat pool, so only Super
  // Admin/Gestionnaire get it below, deliberately not added to any other
  // role's list.
  licensing: ['licensing.device.manage'],
  // Sub-user (member) management — creating sub-users and setting their
  // module/site access. Only Super Admin/Gestionnaire (they both take the
  // full ALL_BUILT_MODULE_ACTIONS set below); no other system role gets it.
  members: ['members.user.manage'],
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
    // plus the existing read-only visibility into stock/invoicing. Cash
    // and stats read access mirrors what READ_ONLY(['invoicing']) already
    // implied before those two had their own keys (invoicing.partner.read
    // used to double as "can see the caisse journal").
    actions: [...ACTIONS.sales, ...READ_ONLY(['stock', 'invoicing', 'cash', 'stats'])],
  },
  {
    name: 'Comptable / Finance',
    // Milestone 10 — finance visibility on both sides of the ledger now
    // that purchasing/sales exist, in addition to the existing full
    // invoicing set. Full cash.* (recording/cancelling encaissements and
    // décaissements is squarely a finance action) and stats read access.
    actions: [...ACTIONS.invoicing, ...ACTIONS.cash, ...ACTIONS.stats, ...READ_ONLY(['stock', 'quality', 'purchasing', 'sales'])],
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

  // Fine-grained permission split: roles created before an action was split
  // keep the equivalent access. Idempotent (upsert), runs every seed.
  console.log('Expanding legacy permissions...');
  const EXPAND: Record<string, string[]> = {
    'cash.entry.write': ['cash.entry.collect', 'cash.entry.disburse', 'cash.entry.cancel'],
    'scan.label.read': ['scan.counter.read', 'scan.counter.ticket'],
    'scan.label.generate': ['scan.counter.create', 'scan.counter.session', 'scan.counter.sell', 'scan.counter.cash'],
  };
  const allModules = await prisma.module.findMany();
  const idByKey = new Map(allModules.map((m) => [m.key, m.id]));
  for (const [legacy, added] of Object.entries(EXPAND)) {
    const holders = await prisma.rolePermission.findMany({ where: { action: legacy } });
    for (const h of holders) {
      for (const action of added) {
        const moduleId = idByKey.get(action.split('.')[0]);
        if (!moduleId) continue;
        await prisma.rolePermission.upsert({
          where: { roleId_moduleId_action: { roleId: h.roleId, moduleId, action } },
          update: {},
          create: { roleId: h.roleId, moduleId, action },
        });
      }
    }
  }

  // Default module prices (Phase 1 grid, docs/Action Plan.md §11 — DZD/mois
  // per site). Created only if absent, so an admin's edits are never
  // overwritten by a reseed. Phase 2+ modules are left unpriced for the
  // admin to set.
  console.log('Seeding default module prices...');
  const DEFAULT_PRICES: Record<string, number> = { stock: 4500, quality: 3000, invoicing: 4000, sites: 1500, scan: 2000, purchasing: 3500, sales: 3500, cash: 2500, stats: 2000 };
  for (const [moduleKey, monthlyPrice] of Object.entries(DEFAULT_PRICES)) {
    const existing = await prisma.modulePrice.findUnique({ where: { moduleKey } });
    if (!existing) await prisma.modulePrice.create({ data: { moduleKey, monthlyPrice } });
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
