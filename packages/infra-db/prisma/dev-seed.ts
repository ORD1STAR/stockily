// Demo data for local development — a demo organization with realistic
// Phase 1 stock across 3 sites, matching docs/Wireframes.html's own demo
// data exactly so the real app shows what the reviewed wireframe showed.
// NOT part of the idempotent `db:seed` (modules/roles) — this creates a
// specific demo org/user, run once via `npm run db:seed:demo` after
// `npm run db:seed`. Re-running is safe (upserts the org/user/products by
// unique key) but will re-post movements each time, so stock quantities
// will drift from the wireframe's numbers on a second run — that's fine for
// a dev seed, not a concern worth guarding against here.
//
// Deliberately uses the REAL StockMovementService (not direct DB writes) to
// reach the target quantities — this exercises the actual domain logic
// (average cost recalculation, the quarantine seam) as a side effect of
// seeding, rather than just being test fixture data.

// Unlike `prisma db seed` (invoked via the Prisma CLI, which loads .env
// itself before running this file), a plain `tsx` invocation doesn't — must
// run before PrismaClient is constructed below, so DATABASE_URL exists by
// then.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { StockMovementService } from '@org/domain-stock';
import { QualityService as DomainQualityService } from '@org/domain-quality';
import { PrismaStockDataPort } from '../src/lib/prisma-stock-data-port.js';
import { PrismaQualityDataPort } from '../src/lib/prisma-quality-data-port.js';

const prisma = new PrismaClient();
const stock = new StockMovementService(new PrismaStockDataPort(prisma));
const quality = new DomainQualityService(new PrismaQualityDataPort(prisma));

const DEMO_ORG_NAME = 'Épicerie El Baraka (démo)';
const DEMO_EMAIL = 'demo@stockily.dz';
const DEMO_PASSWORD_HASH_NOTE = null; // set below via bcryptjs, kept out of this constant so it isn't mistaken for the real hash

const SITES = [
  { key: 'alger', name: 'Alger — Entrepôt Central' },
  { key: 'oran', name: 'Oran — Dépôt Nord' },
  { key: 'constantine', name: 'Constantine — Point de vente' },
];

const CATEGORIES = ['Épicerie', 'Entretien', 'Frais', 'Accessoires'];

const PRODUCTS = [
  { sku: 'HUI-1L-OLV', name: "Huile d'olive extra vierge 1L", category: 'Épicerie', isLotTracked: true, minThreshold: 50, cost: 685 },
  { sku: 'SEM-25K-FIN', name: 'Semoule fine 25kg', category: 'Épicerie', isLotTracked: true, minThreshold: 30, cost: 2450 },
  { sku: 'DET-5L-LIQ', name: 'Détergent liquide 5L', category: 'Entretien', isLotTracked: true, minThreshold: 40, cost: 890 },
  { sku: 'CONS-400G-TOM', name: 'Conserve tomate 400g', category: 'Épicerie', isLotTracked: true, minThreshold: 60, cost: 145 },
  { sku: 'YAO-12X100G', name: 'Yaourt nature — pack 12x100g', category: 'Frais', isLotTracked: true, minThreshold: 100, cost: 210 },
  { sku: 'HUI-5L-TOUR', name: 'Huile de tournesol 5L', category: 'Épicerie', isLotTracked: true, minThreshold: 25, cost: 1780 },
  { sku: 'SAV-BAR-125G', name: 'Savon de Marseille 125g', category: 'Entretien', isLotTracked: true, minThreshold: 20, cost: 95 },
  { sku: 'CEI-105-NR', name: 'Ceinture cuir noir 105cm', category: 'Accessoires', isLotTracked: false, minThreshold: 15, cost: 1250 },
] as const;

// [siteKey, sku, onHandTarget, quarantineTarget] — matches
// docs/Wireframes.html's Stock panel rows, with one deliberate correction:
// the wireframe (a static mockup, never required to be internally
// consistent) showed the Yaourt lot as both "Conforme" in Quality AND
// partly quarantined in Stock — a batch that passed inspection doesn't get
// partially quarantined. Quarantine here now only comes from the real
// Quality flow below (a failed check or an expired batch), not a
// standalone placeholder number, so Yaourt's quarantineTarget drops to 0
// and the entries below that get a dedicated batch are handled separately,
// not through this generic loop (see main()).
const STOCK_TARGETS: [string, string, number, number][] = [
  ['alger', 'DET-5L-LIQ', 96, 0], // generic good stock — the 4 bad units come from LOT-2026-0791 below, received separately so they can be tied to that specific batch
  ['alger', 'HUI-5L-TOUR', 58, 0],
  ['alger', 'SAV-BAR-125G', 14, 0],
  ['alger', 'CEI-105-NR', 62, 0], // 8 of these get quarantined via a product-direct check below — not baked in here
  ['alger', 'CONS-400G-TOM', 0, 0], // values unused — matched by sku below for the dedicated rupture-simulation branch
  ['oran', 'HUI-1L-OLV', 96, 0],
  ['constantine', 'SEM-25K-FIN', 6, 0],
];

// Products/quantities that get a specific batch tied to their receipt, so
// the per-batch ledger derivation (QualityDataPort.getBatchQuantityBySite)
// has real movement history to work from — matches docs/Wireframes.html's
// Quality panel lot numbers exactly.
const BATCH_DEMOS: {
  lotNumber: string;
  sku: string;
  siteKey: string;
  quantity: number;
  expiryInDays: number | null;
  check: 'conforme' | 'non_conforme' | null; // null = no check recorded (e.g. a lot still awaiting inspection) — not used currently, all demo lots get checked
  notes?: string;
}[] = [
  { lotNumber: 'LOT-2026-0847', sku: 'YAO-12X100G', siteKey: 'alger', quantity: 340, expiryInDays: 7, check: 'conforme' },
  { lotNumber: 'LOT-2026-0803', sku: 'HUI-1L-OLV', siteKey: 'alger', quantity: 184, expiryInDays: 295, check: 'conforme' },
  { lotNumber: 'LOT-2026-0779', sku: 'SEM-25K-FIN', siteKey: 'alger', quantity: 22, expiryInDays: 9, check: 'conforme' },
  {
    lotNumber: 'LOT-2026-0791',
    sku: 'DET-5L-LIQ',
    siteKey: 'alger',
    quantity: 4,
    expiryInDays: 1,
    check: 'non_conforme',
    notes: "Défaut d'étanchéité",
  },
];

// Historical lots with nothing left in the ledger (never received via
// stock.recordMovement, so getBatchQuantityBySite correctly derives 0
// everywhere) — matches the wireframe's two "Qté 0" Quality rows: one a
// normal lot long since sold through, one rejected entirely at receipt.
const HISTORICAL_BATCH_DEMOS: {
  lotNumber: string;
  sku: string;
  historicalQuantityReceived: number;
  expiryInDays: number | null;
  check: 'conforme' | 'non_conforme';
  notes?: string;
}[] = [
  { lotNumber: 'LOT-2026-0812', sku: 'CONS-400G-TOM', historicalQuantityReceived: 40, expiryInDays: 206, check: 'conforme' },
  {
    lotNumber: 'LOT-2026-0758',
    sku: 'CONS-400G-TOM',
    historicalQuantityReceived: 12,
    expiryInDays: null,
    check: 'non_conforme',
    notes: "Défaut d'emballage à réception",
  },
];

function inDays(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

async function main() {
  const stockModule = await prisma.module.findUnique({ where: { key: 'stock' } });
  if (!stockModule) {
    throw new Error('Modules are not seeded — run `npm run db:seed` before `npm run db:seed:demo`.');
  }
  const phase1Modules = await prisma.module.findMany({
    where: { key: { in: ['stock', 'quality', 'invoicing', 'sites', 'scan'] } },
  });
  const superAdminRole = await prisma.role.findFirst({ where: { name: 'Super Admin', isSystem: true } });
  if (!superAdminRole) {
    throw new Error('System roles are not seeded — run `npm run db:seed` before `npm run db:seed:demo`.');
  }

  console.log('Creating demo organization...');
  let org = await prisma.organization.findFirst({ where: { name: DEMO_ORG_NAME } });
  if (!org) {
    org = await prisma.organization.create({ data: { name: DEMO_ORG_NAME, plan: 'active' } });
  }

  const existingUser = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (!existingUser) {
    // bcryptjs, matching AuthService's own choice (docs/MILESTONE_1.md) —
    // imported dynamically so this script has no hard dependency on apps/api.
    const bcrypt = await import('bcryptjs');
    const passwordHash = await bcrypt.hash('Demo1234!', 10);
    void DEMO_PASSWORD_HASH_NOTE;
    const user = await prisma.user.create({ data: { orgId: org.id, email: DEMO_EMAIL, passwordHash } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: superAdminRole.id, siteId: null } });
  }

  console.log('Granting active entitlements (demo org — not a trial)...');
  for (const m of phase1Modules) {
    await prisma.organizationModuleEntitlement.upsert({
      where: { orgId_moduleId: { orgId: org.id, moduleId: m.id } },
      update: { status: 'active' },
      create: { orgId: org.id, moduleId: m.id, status: 'active' },
    });
  }

  console.log('Creating sites...');
  const siteIdByKey = new Map<string, string>();
  for (const s of SITES) {
    const site = await prisma.site.findFirst({ where: { orgId: org.id, name: s.name } });
    const created = site ?? (await prisma.site.create({ data: { orgId: org.id, name: s.name } }));
    siteIdByKey.set(s.key, created.id);
  }

  console.log('Creating categories...');
  const categoryIdByName = new Map<string, string>();
  for (const name of CATEGORIES) {
    const existing = await prisma.productCategory.findFirst({ where: { orgId: org.id, name } });
    const created = existing ?? (await prisma.productCategory.create({ data: { orgId: org.id, name } }));
    categoryIdByName.set(name, created.id);
  }

  console.log('Creating products...');
  const productIdBySku = new Map<string, string>();
  for (const p of PRODUCTS) {
    const existing = await prisma.product.findUnique({ where: { orgId_sku: { orgId: org.id, sku: p.sku } } });
    const created =
      existing ??
      (await prisma.product.create({
        data: {
          orgId: org.id,
          sku: p.sku,
          name: p.name,
          categoryId: categoryIdByName.get(p.category) ?? null,
          isLotTracked: p.isLotTracked,
          minThreshold: p.minThreshold,
        },
      }));
    productIdBySku.set(p.sku, created.id);
  }

  // Everything below this line (stock movements, batches, the Ceinture
  // quarantine check, invoices) is NOT idempotent — each re-run posts more
  // movements / creates duplicate batches with the same lot number /
  // quarantines another 8 units / creates more invoices. Caught by
  // actually clicking through the running app (a real lot showing up
  // twice in the Quality table, quarantine counts double what the seed
  // data intended), not by reading the code. One guard here is simpler
  // and more robust than scattering an existence-check into every loop
  // below: if this org already has its first demo batch, the whole demo
  // dataset was already built by a prior run — skip straight to done.
  const alreadySeeded = await prisma.batch.findFirst({ where: { orgId: org.id, lotNumber: BATCH_DEMOS[0].lotNumber } });
  if (alreadySeeded) {
    console.log('Demo data already fully seeded for this org — skipping (re-run against a fresh database to reseed from scratch).');
    console.log(`Log in with ${DEMO_EMAIL} / Demo1234!`);
    return; // main()'s own .finally() below still disconnects prisma
  }

  console.log('Posting stock movements to reach demo quantities (via the real StockMovementService)...');
  for (const [siteKey, sku, onHandTarget, quarantineTarget] of STOCK_TARGETS) {
    const siteId = siteIdByKey.get(siteKey)!;
    const productId = productIdBySku.get(sku)!;
    const product = PRODUCTS.find((p) => p.sku === sku)!;
    const totalToReceive = onHandTarget + quarantineTarget;

    if (sku === 'CONS-400G-TOM') {
      // Wireframe shows this at 0 with a "Rupture" pill — exercise IN then
      // OUT rather than never touching it, so a real StockLevel row (and a
      // real ledger history) exists instead of the product simply never
      // having been received.
      await stock.recordMovement({ orgId: org.id, productId, siteId, type: 'IN', quantity: 60, unitCost: product.cost });
      await stock.recordMovement({ orgId: org.id, productId, siteId, type: 'OUT', quantity: 60 });
      continue;
    }

    if (totalToReceive > 0) {
      await stock.recordMovement({ orgId: org.id, productId, siteId, type: 'IN', quantity: totalToReceive, unitCost: product.cost });
    }
    void quarantineTarget; // no longer used — every quarantine now flows through the real Quality checks below
  }

  console.log('Creating demo batches and posting them through the real Quality flow...');
  for (const demo of BATCH_DEMOS) {
    const productId = productIdBySku.get(demo.sku)!;
    const siteId = siteIdByKey.get(demo.siteKey)!;
    const product = PRODUCTS.find((p) => p.sku === demo.sku)!;

    const batch = await quality.createBatch({
      orgId: org.id,
      productId,
      lotNumber: demo.lotNumber,
      expiryDate: demo.expiryInDays != null ? inDays(demo.expiryInDays) : null,
      quantityReceived: demo.quantity,
    });

    // Tie the receipt to this specific batch so getBatchQuantityBySite has
    // real ledger history to derive from — a batch-based quality check
    // with no matching movements would (correctly) find nothing to
    // quarantine, which is fine for the two "historical, qty 0" lots below
    // but would be wrong here, where the batch IS the org's current stock.
    await stock.recordMovement({
      orgId: org.id,
      productId,
      siteId,
      type: 'IN',
      quantity: demo.quantity,
      batchId: batch.id,
      unitCost: product.cost,
    });

    if (demo.check) {
      const result = await quality.recordQualityCheck({
        orgId: org.id,
        productId,
        batchId: batch.id,
        result: demo.check,
        notes: demo.notes ?? null,
      });
      for (const target of result.quarantineTargets) {
        await stock.quarantine({ orgId: org.id, productId, siteId: target.siteId, quantity: target.quantity, reason: demo.notes ?? 'Contrôle qualité' });
      }
    }
  }

  console.log('Creating historical batches (already depleted — nothing left in the ledger)...');
  for (const demo of HISTORICAL_BATCH_DEMOS) {
    const productId = productIdBySku.get(demo.sku)!;
    const batch = await quality.createBatch({
      orgId: org.id,
      productId,
      lotNumber: demo.lotNumber,
      expiryDate: demo.expiryInDays != null ? inDays(demo.expiryInDays) : null,
      quantityReceived: demo.historicalQuantityReceived,
    });
    // Deliberately no stock.recordMovement call — this batch's ledger
    // history predates this seed run (or, for the rejected-at-receipt lot,
    // never entered good stock at all), so quarantineTargets will
    // correctly come back empty; nothing to actually quarantine, only the
    // check/non-conformity record itself matters here.
    await quality.recordQualityCheck({ orgId: org.id, productId, batchId: batch.id, result: demo.check, notes: demo.notes ?? null });
  }

  console.log('Quarantining 8 units of the non-lot-tracked Ceinture via a product-direct check...');
  {
    const productId = productIdBySku.get('CEI-105-NR')!;
    const siteId = siteIdByKey.get('alger')!;
    const result = await quality.recordQualityCheck({
      orgId: org.id,
      productId,
      siteId,
      quantity: 8,
      result: 'non_conforme',
      notes: 'Défaut de couture à la livraison',
    });
    for (const target of result.quarantineTargets) {
      await stock.quarantine({ orgId: org.id, productId, siteId: target.siteId, quantity: target.quantity, reason: 'Défaut de couture à la livraison' });
    }
  }

  console.log('Running the expiry sweep (creates near-expiry alerts for the demo lots)...');
  await quality.runExpirySweep(org.id);

  console.log("Setting the demo org's own legal profile (required to finalize a CUSTOMER invoice)...");
  await prisma.organization.update({
    where: { id: org.id },
    data: {
      address: '14 rue des Frères Bouadou, Alger',
      nif: '0026 2100 1847 03',
      nis: '098226184700017',
      rc: '16/00-3218472 B24',
      taxArticle: '34117210084',
      phone: '+213 21 00 00 00',
      email: 'contact@stockily.dz',
    },
  });

  console.log('Creating demo tax rate and partners...');
  const existingTva = await prisma.taxRate.findFirst({ where: { orgId: org.id, name: 'TVA' } });
  const tva = existingTva ?? (await prisma.taxRate.create({ data: { orgId: org.id, name: 'TVA', rate: 19, isDefault: true } }));

  const PARTNER_DEMOS = [
    { name: 'SARL Épicerie El Baraka', nif: '0026 2100 1847 03' },
    { name: 'Ets Boudiaf & Fils', nif: '0026 9800 2214 09' },
    { name: 'Superette Aïn Naadja', nif: '0026 1200 9981 02' },
    { name: 'Grossiste Nord Distribution', nif: '0026 0533 1120 17' },
  ];
  const partnerIdByName = new Map<string, string>();
  for (const p of PARTNER_DEMOS) {
    const existing = await prisma.partner.findFirst({ where: { orgId: org.id, name: p.name } });
    const created = existing ?? (await prisma.partner.create({ data: { orgId: org.id, name: p.name, isCustomer: true, nif: p.nif } }));
    partnerIdByName.set(p.name, created.id);
  }

  console.log('Creating demo invoices (matching docs/Wireframes.html)...');
  const algerSiteId = siteIdByKey.get('alger')!;

  async function createAndFinalize(partnerName: string | null, lines: { description: string; quantity: number; unitPrice: number }[], payFraction: 1 | 0.5 | 0) {
    const invoice = await prisma.invoice.create({
      data: {
        orgId: org.id,
        siteId: algerSiteId,
        type: 'CUSTOMER',
        partnerId: partnerName ? partnerIdByName.get(partnerName) : null,
        status: 'draft',
        lines: { create: lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, taxRateId: tva.id })) },
      },
    });
    // Assign the gapless number directly here (same mechanism as
    // InvoicingService.finalizeInvoice) rather than calling that service —
    // this is dev-seed data with no stock-linked lines, so there is no
    // corresponding stock deduction to reproduce, and depending on
    // apps/api from packages/infra-db would cross a layering boundary this
    // repo otherwise keeps clean (domain-* / infra-db never import from apps/*).
    const year = new Date().getFullYear();
    const rows = await prisma.$queryRaw<{ lastNumber: number }[]>`
      INSERT INTO "invoice_counters" ("orgId", "year", "lastNumber")
      VALUES (${org.id}, ${year}, 1)
      ON CONFLICT ("orgId", "year")
      DO UPDATE SET "lastNumber" = "invoice_counters"."lastNumber" + 1
      RETURNING "lastNumber"
    `;
    const number = `FA-${year}-${String(rows[0].lastNumber).padStart(6, '0')}`;
    const totalTtc = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0) * 1.19;
    await prisma.invoice.update({ where: { id: invoice.id }, data: { number, status: 'unpaid', finalizedAt: new Date() } });
    if (payFraction > 0) {
      const amount = Math.round(totalTtc * payFraction * 100) / 100;
      await prisma.payment.create({ data: { invoiceId: invoice.id, amount } });
      await prisma.invoice.update({ where: { id: invoice.id }, data: { status: payFraction >= 1 ? 'paid' : 'partially_paid' } });
    }
  }

  await createAndFinalize('SARL Épicerie El Baraka', [{ description: "Huile d'olive 1L — carton de 12", quantity: 40, unitPrice: 980 }], 1);
  await createAndFinalize('Ets Boudiaf & Fils', [{ description: 'Semoule fine 25kg — palette', quantity: 20, unitPrice: 2450 }], 0.5);
  await createAndFinalize('Superette Aïn Naadja', [{ description: 'Assortiment épicerie', quantity: 1, unitPrice: 27850 }], 0);
  await createAndFinalize(null, [{ description: 'Vente comptoir', quantity: 1, unitPrice: 6200 }], 1);
  await createAndFinalize('Grossiste Nord Distribution', [{ description: "Huile de tournesol 5L — lot", quantity: 50, unitPrice: 6112 }], 1);

  console.log(`Demo seed complete. Log in with ${DEMO_EMAIL} / Demo1234!`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
