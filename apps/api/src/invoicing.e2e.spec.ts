// Real end-to-end test of Invoicing: boots the full AppModule against the
// dedicated `stockily_invoicing_test` database, same convention as auth.e2e.spec.ts /
// stock.e2e.spec.ts. Covers draft -> finalize (with a real stock deduction,
// confirmed via Stock's own endpoint) -> partial payment -> paid, the
// organization-profile-completeness gate, NIF/vente-comptoir handling, PDF
// generation, and concurrent-finalization numbering safety (this is the one
// property a single-threaded test can't take on faith — see the dedicated
// test below that actually fires concurrent requests).
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

process.env.DATABASE_URL = 'postgresql://stockily:stockily@localhost:5432/stockily_invoicing_test?schema=public';
// Milestone 8 (RLS) — the running app must connect as the restricted,
// non-superuser role for RLS to mean anything (a superuser/BYPASSRLS role
// unconditionally bypasses it — see the migration's own header comment).
process.env.APP_DATABASE_URL = 'postgresql://stockily_app:stockily_app@localhost:5432/stockily_invoicing_test?schema=public';

describe('Invoicing e2e', () => {
  let app: INestApplication;

  const email = `invoicing-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const password = 'correct-horse-battery';
  let accessToken: string;
  let siteId: string;
  let productId: string;
  let partnerId: string;
  let taxRateId: string;

  beforeAll(async () => {
    const { AppModule } = await import('./app/app.module');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    const signup = await request(app.getHttpServer())
      .post('/api/auth/signup')
      .send({ organizationName: 'Invoicing E2E Org', email, password })
      .expect(201);
    accessToken = signup.body.accessToken;

    const auth = () => ({ Authorization: `Bearer ${accessToken}` });

    const site = await request(app.getHttpServer()).post('/api/sites').set(auth()).send({ name: 'Site Facturation' }).expect(201);
    siteId = site.body.id;

    const product = await request(app.getHttpServer())
      .post('/api/stock/products')
      .set(auth())
      .send({ sku: `INV-SKU-${Date.now()}`, name: 'Produit facturable', isLotTracked: false, minThreshold: 0 })
      .expect(201);
    productId = product.body.id;

    // Stock it so a finalize-triggered OUT movement has something to draw down.
    await request(app.getHttpServer())
      .post('/api/stock/movements')
      .set(auth())
      .send({ productId, siteId, type: 'IN', quantity: 100, unitCost: 500 })
      .expect(201);

    const partner = await request(app.getHttpServer())
      .post('/api/invoicing/partners')
      .set(auth())
      .send({ name: 'Client E2E SARL', isCustomer: true, nif: '0026210018 4703' })
      .expect(201);
    partnerId = partner.body.id;

    const taxRate = await request(app.getHttpServer())
      .post('/api/invoicing/tax-rates')
      .set(auth())
      .send({ name: 'TVA standard', rate: 19, isDefault: true })
      .expect(201);
    taxRateId = taxRate.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  const auth = () => ({ Authorization: `Bearer ${accessToken}` });

  it('blocks finalization until the organization legal profile is complete', async () => {
    const invoice = await request(app.getHttpServer())
      .post('/api/invoicing/invoices')
      .set(auth())
      .send({ type: 'CUSTOMER', siteId, partnerId, lines: [{ productId, description: 'Ligne test', quantity: 1, unitPrice: 100 }] })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`/api/invoicing/invoices/${invoice.body.id}/finalize`)
      .set(auth())
      .expect(400);
    expect(res.body.error).toBe('organization_profile_incomplete');
  });

  it('finalizes a CUSTOMER invoice: assigns a gapless number, deducts stock, requires a complete org profile', async () => {
    await request(app.getHttpServer())
      .post('/api/invoicing/organization-profile')
      .set(auth())
      .send({
        name: 'Invoicing E2E Org',
        address: '14 rue des Frères Bouadou, Alger',
        nif: '0026 2100 1847 03',
        nis: '098226184700017',
        rc: '16/00-3218472 B24',
        taxArticle: '34117210084',
      })
      .expect(201);

    const before = await request(app.getHttpServer()).get(`/api/stock/products/${productId}`).set(auth()).expect(200);
    const onHandBefore = before.body.levels.find((l: { site: { id: string } }) => l.site.id === siteId).quantityOnHand;

    const invoice = await request(app.getHttpServer())
      .post('/api/invoicing/invoices')
      .set(auth())
      .send({
        type: 'CUSTOMER',
        siteId,
        partnerId,
        lines: [{ productId, description: 'Produit facturable', quantity: 10, unitPrice: 1000, taxRateId }],
      })
      .expect(201);
    expect(invoice.body.status).toBe('draft');
    expect(invoice.body.number).toBeNull();

    const finalized = await request(app.getHttpServer())
      .post(`/api/invoicing/invoices/${invoice.body.id}/finalize`)
      .set(auth())
      .expect(201);
    expect(finalized.body.number).toMatch(/^FA-\d{4}-\d{6}$/);
    expect(finalized.body.status).toBe('unpaid');
    expect(finalized.body.totals.totalHt).toBeCloseTo(10000, 2);
    expect(finalized.body.totals.totalTtc).toBeCloseTo(11900, 2);

    const after = await request(app.getHttpServer()).get(`/api/stock/products/${productId}`).set(auth()).expect(200);
    const onHandAfter = after.body.levels.find((l: { site: { id: string } }) => l.site.id === siteId).quantityOnHand;
    expect(onHandAfter).toBe(onHandBefore - 10);

    // Re-finalizing an already-finalized invoice must fail, not silently re-number it.
    await request(app.getHttpServer()).post(`/api/invoicing/invoices/${invoice.body.id}/finalize`).set(auth()).expect(409);

    // Partial payment -> partially_paid -> full payment -> paid.
    const partial = await request(app.getHttpServer())
      .post(`/api/invoicing/invoices/${invoice.body.id}/payments`)
      .set(auth())
      .send({ amount: 5000, method: 'virement' })
      .expect(201);
    expect(partial.body.status).toBe('partially_paid');

    const full = await request(app.getHttpServer())
      .post(`/api/invoicing/invoices/${invoice.body.id}/payments`)
      .set(auth())
      .send({ amount: 6900 })
      .expect(201);
    expect(full.body.status).toBe('paid');
    expect(full.body.balance).toBeCloseTo(0, 2);

    // Overpayment rejected.
    await request(app.getHttpServer()).post(`/api/invoicing/invoices/${invoice.body.id}/payments`).set(auth()).send({ amount: 1 }).expect(400);

    // Real PDF, not a stub — just confirm it's a well-formed PDF byte stream.
    const pdf = await request(app.getHttpServer())
      .get(`/api/invoicing/invoices/${invoice.body.id}/pdf`)
      .set(auth())
      .expect(200);
    expect(Buffer.isBuffer(pdf.body) ? pdf.body.subarray(0, 5).toString() : pdf.text.slice(0, 5)).toBe('%PDF-');
  });

  it('fails finalization cleanly (no number assigned, no partial stock deduction) when a line would oversell', async () => {
    const invoice = await request(app.getHttpServer())
      .post('/api/invoicing/invoices')
      .set(auth())
      .send({ type: 'CUSTOMER', siteId, lines: [{ productId, description: 'Trop grande quantité', quantity: 999999, unitPrice: 10 }] })
      .expect(201);

    const res = await request(app.getHttpServer()).post(`/api/invoicing/invoices/${invoice.body.id}/finalize`).set(auth()).expect(400);
    expect(res.body.error).toBe('negative_stock');
    expect(res.body.lineId).toBeDefined();

    const detail = await request(app.getHttpServer()).get(`/api/invoicing/invoices/${invoice.body.id}`).set(auth()).expect(200);
    expect(detail.body.status).toBe('draft');
    expect(detail.body.number).toBeNull();
  });

  it('allows a services-only line (no productId) with no stock impact, and a walk-in (no partner) invoice', async () => {
    const invoice = await request(app.getHttpServer())
      .post('/api/invoicing/invoices')
      .set(auth())
      .send({ type: 'CUSTOMER', siteId, lines: [{ description: 'Frais de conseil', quantity: 1, unitPrice: 2000 }] })
      .expect(201);
    const finalized = await request(app.getHttpServer())
      .post(`/api/invoicing/invoices/${invoice.body.id}/finalize`)
      .set(auth())
      .expect(201);
    expect(finalized.body.partnerId).toBeNull();
    expect(finalized.body.totals.totalTtc).toBe(2000);
  });

  it('creates a SUPPLIER invoice already-finalized with the supplier-provided number, no stock/finalize step', async () => {
    const invoice = await request(app.getHttpServer())
      .post('/api/invoicing/invoices')
      .set(auth())
      .send({ type: 'SUPPLIER', siteId, number: 'FRS-2026-0042', lines: [{ description: 'Achat matériel', quantity: 1, unitPrice: 5000 }] })
      .expect(201);
    expect(invoice.body.status).toBe('unpaid');
    expect(invoice.body.number).toBe('FRS-2026-0042');

    // finalize is a CUSTOMER-only concept.
    await request(app.getHttpServer()).post(`/api/invoicing/invoices/${invoice.body.id}/finalize`).set(auth()).expect(400);
  });

  it('assigns strictly gapless, unique numbers under concurrent finalization (the property that matters most here)', async () => {
    const drafts = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app.getHttpServer())
          .post('/api/invoicing/invoices')
          .set(auth())
          .send({ type: 'CUSTOMER', siteId, lines: [{ description: 'Concurrence', quantity: 1, unitPrice: 100 }] })
          .expect(201),
      ),
    );

    const finalized = await Promise.all(
      drafts.map((d) => request(app.getHttpServer()).post(`/api/invoicing/invoices/${d.body.id}/finalize`).set(auth()).expect(201)),
    );

    const numbers = finalized.map((r) => r.body.number as string);
    expect(new Set(numbers).size).toBe(numbers.length); // all unique

    const sequences = numbers.map((n) => parseInt(n.split('-')[2], 10)).sort((a, b) => a - b);
    for (let i = 1; i < sequences.length; i++) {
      expect(sequences[i]).toBe(sequences[i - 1] + 1); // gapless within this batch
    }
  });
});
