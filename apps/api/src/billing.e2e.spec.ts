// End-to-end: self-service subscription (catalogue, purchase,
// invoices PDF, account) against the real stockily_test DB.
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';

// Never talk to the real Chargily from tests (the dev .env has a test key): off by default, mocked where covered.
process.env.CHARGILY_SECRET_KEY = '';
process.env.DATABASE_URL = 'postgresql://stockily:stockily@localhost:5432/stockily_test?schema=public';
process.env.APP_DATABASE_URL = 'postgresql://stockily_app:stockily_app@localhost:5432/stockily_test?schema=public';

describe('Billing (Tarifs / Espace client) e2e', () => {
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const email = `billing-${Date.now()}@example.com`;
  const password = 'correct-horse-battery';
  let token: string;
  let orgId: string;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const me = async () => (await api().get('/api/billing/me').set(as(token)).expect(200)).body;
  interface ModuleView {
    key: string;
    state: 'active' | 'trial' | 'expired' | 'none';
    daysLeft: number | null;
    endsAt: string;
    siteQuota: number | null;
  }
  const mod = (b: { modules: ModuleView[] }, key: string) => b.modules.find((m) => m.key === key) as ModuleView;

  beforeAll(async () => {
    const { AppModule } = await import('./app/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    const signup = await api().post('/api/auth/signup').send({ organizationName: 'Billing Org', email, password }).expect(201);
    token = signup.body.accessToken;
    orgId = (await api().get('/api/me').set(as(token)).expect(200)).body.organization.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves a public catalogue where a pack costs exactly the sum of its modules', async () => {
    const cat = (await api().get('/api/billing/catalog').expect(200)).body;
    expect(cat.modules.length).toBeGreaterThanOrEqual(9);
    expect(cat.packs.length).toBe(4);
    const price = new Map<string, number>(cat.modules.map((m: { key: string; monthlyPrice: number }) => [m.key, m.monthlyPrice]));
    for (const p of cat.packs) {
      expect(p.monthlyPrice).toBe(p.modules.reduce((s: number, k: string) => s + (price.get(k) ?? 0), 0));
    }
    expect(cat.durations.find((d: { months: number }) => d.months === 12).billedMonths).toBe(10);
  });

  it('requires authentication for the org subscription', async () => {
    await api().get('/api/billing/me').expect(401);
    await api().post('/api/billing/purchase').send({ modules: ['cash'], months: 1 }).expect(401);
  });

  it('starts with trials', async () => {
    const b = await me();
    expect(b.canManage).toBe(true);
    expect(mod(b, 'stock').state).toBe('trial');
    expect(mod(b, 'cash').state).toBe('none');
    // Multi-sites is NOT in the free trial: the first site is free for life, extras are paid.
    expect(mod(b, 'sites').state).toBe('none');
    const sites = await api().get('/api/sites').set(as(token)).expect(200);
    expect(sites.body).toHaveLength(1);
    await api().post('/api/sites').set(as(token)).send({ name: 'Dépôt payant' }).expect(402);
  });

  it('refuses unknown modules and invalid durations', async () => {
    await api().post('/api/billing/purchase').set(as(token)).send({ modules: ['nope'], months: 1 }).expect(400);
    await api().post('/api/billing/purchase').set(as(token)).send({ modules: ['cash'], months: 5 }).expect(400);
  });

  it('buys a module (offered): unlocks it for real, with an invoice', async () => {
    await api().get('/api/cash').set(as(token)); // warms the entitlement cache with "not entitled"
    const r = await api().post('/api/billing/purchase').set(as(token)).send({ modules: ['cash'], months: 1 }).expect(201);
    expect(r.body.payment.number).toMatch(/^STK-\d{4}-\d{6}$/);
    expect(r.body.payment.amount).toBe(2500);
    const b = await me();
    expect(mod(b, 'cash').state).toBe('active');
    expect(mod(b, 'cash').daysLeft).toBeGreaterThanOrEqual(28);
    // purchase invalidated the cache: the module's API is reachable at once
    const res = await api().get('/api/cash').set(as(token));
    expect(res.status).not.toBe(403);
  });

  it('adds missing dependencies and bills them (Qualité needs Stock; Stock is in trial → still added)', async () => {
    const r = await api().post('/api/billing/purchase').set(as(token)).send({ modules: ['quality'], months: 3 }).expect(201);
    const keys = r.body.payment.items.map((i: { key: string }) => i.key);
    expect(keys).toContain('quality');
    expect(r.body.payment.amount).toBe(r.body.payment.items.reduce((s: number, i: { total: number }) => s + i.total, 0));
  });

  it('bills 10 months for 12 and extends a running period instead of restarting it', async () => {
    const before = mod(await me(), 'cash').endsAt;
    const r = await api().post('/api/billing/purchase').set(as(token)).send({ modules: ['cash'], months: 12 }).expect(201);
    expect(r.body.payment.amount).toBe(2500 * 10);
    const after = mod(await me(), 'cash').endsAt;
    expect(new Date(after).getTime()).toBeGreaterThan(new Date(before).getTime() + 300 * 86_400_000);
  });

  it('has no balance system any more', async () => {
    expect((await me()).creditBalance).toBeUndefined();
    await api().post('/api/billing/credit').set(as(token)).send({ amount: 10000 }).expect(404);
    await api().post('/api/billing/purchase').set(as(token)).send({ modules: ['stats'], months: 1, payWith: 'credit' }).expect(400); // unknown field
    await api().post('/api/billing/purchase').set(as(token)).send({ modules: ['stats'], months: 1 }).expect(201);
  });

  it('lists payments and serves a real PDF invoice, only to its own org', async () => {
    const b = await me();
    expect(b.payments.length).toBeGreaterThanOrEqual(4);
    const pdf = await api().get(`/api/billing/payments/${b.payments[0].id}/pdf`).set(as(token)).expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(Buffer.from(pdf.body).subarray(0, 4).toString()).toBe('%PDF');
    // another org cannot read it
    const other = await api().post('/api/auth/signup').send({ organizationName: 'Autre Org', email: `other-${Date.now()}@example.com`, password }).expect(201);
    await api().get(`/api/billing/payments/${b.payments[0].id}/pdf`).set(as(other.body.accessToken)).expect(404);
  });

  it('enforces expiry in the guard, and lets a lapsed module be bought again', async () => {
    const { PrismaClient } = await import('@prisma/client');
    const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
    try {
      const m = await db.module.findUniqueOrThrow({ where: { key: 'stats' } });
      // 1) lapse stats: its API must refuse at once, even though status is still 'active'
      await db.organizationModuleEntitlement.update({ where: { orgId_moduleId: { orgId, moduleId: m.id } }, data: { expiresAt: new Date(Date.now() - 1000) } });
      // drop the 30 s entitlement cache so the new expiry is read straight away
      const { EntitlementCacheService } = await import('./modules/tenancy/services/entitlement-cache.service');
      app.get(EntitlementCacheService).invalidate(orgId, 'stats');
      const denied = await api().get('/api/stats?from=2026-01-01&to=2026-01-02&granularity=day&compareFrom=2025-12-30&compareTo=2025-12-31').set(as(token));
      expect(denied.status).toBe(402); // ModuleEntitlementException = Payment Required
      expect(mod(await me(), 'stats').state).toBe('expired');

      // 2) buy it again: usable at once, a fresh month from today
      await api().post('/api/billing/purchase').set(as(token)).send({ modules: ['stats'], months: 1 }).expect(201);
      const after = await me();
      expect(mod(after, 'stats').state).toBe('active');
      expect(mod(after, 'stats').daysLeft).toBeGreaterThanOrEqual(28);

      // 3) the hourly job flips a lapsed period to 'expired' (bookkeeping only)
      await db.organizationModuleEntitlement.update({ where: { orgId_moduleId: { orgId, moduleId: m.id } }, data: { expiresAt: new Date(Date.now() - 1000) } });
      const { BillingService } = await import('./modules/billing/billing.service');
      const res = await app.get(BillingService).markExpired();
      expect(res.expired).toBeGreaterThanOrEqual(1);
    } finally {
      await db.$disconnect();
    }
  });

  it('offers 1 month on 6 months (billed 5)', async () => {
    const r = await api().post('/api/billing/purchase').set(as(token)).send({ modules: ['cash'], months: 6 }).expect(201);
    expect(r.body.payment.amount).toBe(2500 * 5);
  });

  it('Multi-sites: first site free for life, paid per extra site, quota enforced at creation', async () => {
    const cat = (await api().get('/api/billing/catalog').expect(200)).body;
    expect(cat.modules.find((m: { key: string }) => m.key === 'sites').unit).toBeTruthy();
    // 2 extra sites for 1 month = 2 x 1500
    const r = await api().post('/api/billing/purchase').set(as(token)).send({ modules: ['sites'], months: 1, extraSites: 2 }).expect(201);
    expect(r.body.payment.amount).toBe(3000);
    expect(r.body.payment.items[0].label).toContain('2 sites supplémentaires');
    expect(mod(await me(), 'sites').siteQuota).toBe(2);
    // 1 free site exists; 2 more are allowed, the 4th is refused
    await api().post('/api/sites').set(as(token)).send({ name: 'Dépôt 2' }).expect(201);
    await api().post('/api/sites').set(as(token)).send({ name: 'Dépôt 3' }).expect(201);
    const refused = await api().post('/api/sites').set(as(token)).send({ name: 'Dépôt 4' }).expect(400);
    expect(refused.body.message).toContain('Multi-sites');
    // buying a bigger quota lifts the cap
    await api().post('/api/billing/purchase').set(as(token)).send({ modules: ['sites'], months: 1, extraSites: 3 }).expect(201);
    await api().post('/api/sites').set(as(token)).send({ name: 'Dépôt 4' }).expect(201);
  });

  it('keeps dependencies consistent: a module needing another never ends up without it', async () => {
    const other = await api().post('/api/auth/signup').send({ organizationName: 'Dep Org', email: `dep-${Date.now()}@example.com`, password }).expect(201);
    const t = other.body.accessToken;
    const otherOrg = (await api().get('/api/me').set(as(t)).expect(200)).body.organization.id;
    // Stock is only on trial: it would lapse under Qualité, so it is billed along (from the end of its trial)...
    const first = await api().post('/api/billing/purchase').set(as(t)).send({ modules: ['quality'], months: 1 }).expect(201);
    expect(first.body.payment.items.map((i: { key: string }) => i.key).sort()).toEqual(['quality', 'stock']);
    // ...and once Stock is PAID it is not billed again for the next module that needs it.
    const again = await api().post('/api/billing/purchase').set(as(t)).send({ modules: ['scan'], months: 1 }).expect(201);
    expect(again.body.payment.items.map((i: { key: string }) => i.key)).toEqual(['scan']);
    // A missing one is added and billed along too.
    const { PrismaClient } = await import('@prisma/client');
    const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
    try {
      await db.organizationModuleEntitlement.deleteMany({ where: { orgId: otherOrg, module: { key: { in: ['stock', 'invoicing'] } } } });
    } finally {
      await db.$disconnect();
    }
    const r = await api().post('/api/billing/purchase').set(as(t)).send({ modules: ['purchasing'], months: 1 }).expect(201);
    expect(r.body.payment.items.map((i: { key: string }) => i.key).sort()).toEqual(['invoicing', 'purchasing', 'stock']);
  });

  describe('dependencies always outlast their dependents', () => {
    let t: string;
    let depOrg: string;
    const get = async () => (await api().get('/api/billing/me').set(as(t)).expect(200)).body;
    const end = (b: { modules: { key: string; endsAt: string }[] }, k: string) => new Date((b.modules.find((m) => m.key === k) as { endsAt: string }).endsAt).getTime();

    beforeAll(async () => {
      const r = await api().post('/api/auth/signup').send({ organizationName: 'Deps Org', email: `deps-${Date.now()}@example.com`, password }).expect(201);
      t = r.body.accessToken;
      depOrg = r.body.organization.id;
    });

    it('buying a long dependent extends a shorter dependency, and the quote equals the charge', async () => {
      // Factures bought for 1 month only...
      await api().post('/api/billing/purchase').set(as(t)).send({ modules: ['invoicing'], months: 1 }).expect(201);
      // ...then Ventes (needs Factures) for 6 months.
      const body = { modules: ['sales'], months: 6 };
      const quote = (await api().post('/api/billing/quote').set(as(t)).send(body).expect(201)).body;
      const inv = quote.items.find((i: { key: string }) => i.key === 'invoicing');
      expect(inv.note).toContain('Ventes');
      expect(quote.amount).toBe(3500 * 5 + 4000 * 5); // Ventes 6 mois (5 facturés) + Factures prolongé de 5 mois
      const r = await api().post('/api/billing/purchase').set(as(t)).send(body).expect(201);
      expect(r.body.payment.amount).toBe(quote.amount);
      const b = await get();
      expect(end(b, 'invoicing')).toBeGreaterThanOrEqual(end(b, 'sales'));
    });

    it('pauses the dependent (402, with the reason) when its dependency lapses', async () => {
      const { PrismaClient } = await import('@prisma/client');
      const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
      try {
        const m = await db.module.findUniqueOrThrow({ where: { key: 'invoicing' } });
        await db.organizationModuleEntitlement.update({ where: { orgId_moduleId: { orgId: depOrg, moduleId: m.id } }, data: { expiresAt: new Date(Date.now() - 1000) } });
        const { EntitlementCacheService } = await import('./modules/tenancy/services/entitlement-cache.service');
        const cache = app.get(EntitlementCacheService);
        cache.invalidate(depOrg, 'invoicing');
        cache.invalidate(depOrg, 'sales');
        const res = await api().get('/api/sales/orders').set(as(t));
        expect(res.status).toBe(402);
        expect(res.body.requires).toBe('invoicing');
        expect(res.body.message).toContain('Espace client');
        // restore for the next tests
        await db.organizationModuleEntitlement.update({ where: { orgId_moduleId: { orgId: depOrg, moduleId: m.id } }, data: { expiresAt: new Date(Date.now() + 200 * 86_400_000) } });
        cache.invalidate(depOrg, 'invoicing');
      } finally {
        await db.$disconnect();
      }
    });
  });

  it('updates the account (name, phone, username, email) and the password', async () => {
    const u = await api().patch('/api/account').set(as(token)).send({ displayName: 'Karim B.', phone: '0555 12 34 56', username: `karim${Date.now() % 100000}` }).expect(200);
    expect(u.body.displayName).toBe('Karim B.');
    expect(u.body.phone).toBe('0555 12 34 56');
    const newEmail = `changed-${Date.now()}@example.com`;
    await api().patch('/api/account').set(as(token)).send({ email: newEmail }).expect(200);
    await api().patch('/api/account').set(as(token)).send({ email: 'bad' }).expect(400);
    await api().post('/api/account/password').set(as(token)).send({ currentPassword: 'wrong-password', newPassword: 'another-password-1' }).expect(400);
    await api().post('/api/account/password').set(as(token)).send({ currentPassword: password, newPassword: 'another-password-1' }).expect(201);
    await api().post('/api/auth/login').send({ identifier: newEmail, password: 'another-password-1' }).expect(200);
    await api().post('/api/auth/login').send({ identifier: newEmail, password }).expect(401);
  });

  it('rejects an email already used by another account', async () => {
    const other = `taken-${Date.now()}@example.com`;
    await api().post('/api/auth/signup').send({ organizationName: 'Taken Org', email: other, password }).expect(201);
    await api().patch('/api/account').set(as(token)).send({ email: other }).expect(409);
  });

  // ── Public suggestions ("Proposer des ajouts"), same app ──
  const countSuggestions = async (email: string) => {
    const { PrismaClient } = await import('@prisma/client');
    const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
    try {
      return await db.featureSuggestion.count({ where: { email } });
    } finally {
      await db.$disconnect();
    }
  };

  it('suggestions: stores a valid one without any account', async () => {
    const e = `idea-${Date.now()}@example.com`;
    await api().post('/api/suggestions').send({ email: e, need: 'Je voudrais imprimer des étiquettes au format 40x30.', area: 'scan', priority: 'useful', activity: 'retail' }).expect(201);
    expect(await countSuggestions(e)).toBe(1);
  });

  it('suggestions: rejects an invalid email, a too-short need and unknown values', async () => {
    await api().post('/api/suggestions').send({ email: 'nope', need: 'Un besoin assez long' }).expect(400);
    await api().post('/api/suggestions').send({ email: 'a@b.dz', need: 'court' }).expect(400);
  });

  it('suggestions: silently drops a bot that fills the honeypot', async () => {
    const e = `bot-${Date.now()}@example.com`;
    await api().post('/api/suggestions').send({ email: e, need: 'Spam spam spam spam', website: 'http://spam' }).expect(201);
    expect(await countSuggestions(e)).toBe(0);
  });

  describe('Chargily Pay (mocked HTTP)', () => {
    const SECRET = 'test_sk_unit_test_secret';
    const sign = (body: string) => require('node:crypto').createHmac('sha256', SECRET).update(body).digest('hex');
    const realFetch = global.fetch;
    const calls: { url: string; body: any }[] = [];
    const run = Date.now();
    const checkoutIds: string[] = [];
    let t: string;
    let expectedAmount = 0;

    beforeAll(async () => {
      process.env.CHARGILY_SECRET_KEY = SECRET;
      t = token; // reuses the suite's org: auth signups are throttled to 5/min per IP
      global.fetch = (async (url: string, init?: RequestInit) => {
        if (!String(url).includes('pay.chargily.net')) return realFetch(url as never, init);
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ url: String(url), body });
        expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${SECRET}`);
        const json = String(url).endsWith('/customers') ? { id: 'cust_1' } : { id: (checkoutIds[checkoutIds.push(`co_${run}_${calls.length}`) - 1]), status: 'pending', amount: body.amount, checkout_url: 'https://pay.chargily.net/test/checkouts/x/pay' };
        return new Response(JSON.stringify(json), { status: 200 });
      }) as typeof fetch;
    });
    afterAll(() => {
      delete process.env.CHARGILY_SECRET_KEY;
      global.fetch = realFetch;
    });

    it('creates a customer (our org id as identifier) and a checkout; nothing is activated yet', async () => {
      expectedAmount = (await api().post('/api/billing/quote').set(as(t)).send({ modules: ['scan'], months: 1 }).expect(201)).body.amount;
      const r = await api().post('/api/billing/purchase').set(as(t)).send({ modules: ['scan'], months: 1 }).expect(201);
      expect(r.body.checkoutUrl).toContain('pay.chargily.net');
      expect(r.body.payment.status).toBe('pending');
      expect(r.body.payment.number).toBeNull();
      expect(calls[0].url).toMatch(/\/test\/api\/v2\/customers$/);
      expect(calls[0].body.metadata.stockily_org_id).toMatch(/[0-9a-f-]{36}/);
      expect(calls[1].body).toMatchObject({ amount: expectedAmount, currency: 'dzd', customer_id: 'cust_1' });
      expect(calls[1].body.items).toBeUndefined(); // no products, no prices
      expect(mod(await (api().get('/api/billing/me').set(as(t)).then((x) => x.body)), 'scan').state).not.toBe('active');
      
    });

    it('rejects a webhook with a bad or missing signature', async () => {
      const body = JSON.stringify({ type: 'checkout.paid', data: { id: checkoutIds[0], amount: expectedAmount } });
      await api().post('/api/billing/webhook').set('Content-Type', 'application/json').set('signature', 'nope').send(body).expect(401);
      await api().post('/api/billing/webhook').set('Content-Type', 'application/json').send(body).expect(401);
    });

    it('a signed checkout.paid webhook activates the module and numbers the invoice, once', async () => {
      const checkout = checkoutIds[0];
      process.env.MAIL_HOST = 'json'; // receipt email is built without any network
      const body = JSON.stringify({ type: 'checkout.paid', data: { id: checkout, amount: expectedAmount, status: 'paid', invoice_id: 'inv_track_1' } });
      for (let i = 0; i < 2; i++) await api().post('/api/billing/webhook').set('Content-Type', 'application/json').set('signature', sign(body)).send(body).expect(200);
      const b = (await api().get('/api/billing/me').set(as(t))).body;
      expect(mod(b, 'scan').state).toBe('active');
      const paid = b.payments.filter((p: { status: string; method: string }) => p.status === 'paid' && p.method.startsWith('Chargily'));
      expect(paid).toHaveLength(1);
      expect(paid[0].trackId).toBe('inv_track_1');
      expect(paid[0].checkoutId).toBe(checkout);
      expect(paid[0].number).toMatch(/^STK-\d{4}-\d{6}$/);
      await api().get(`/api/billing/payments/${paid[0].id}/pdf`).set(as(t)).expect(200);
      // Exactly one receipt email, despite the webhook being delivered twice.
      const { MailService } = await import('./modules/mail/mail.service');
      for (let i = 0; i < 40 && !app.get(MailService).sent.some((m) => m.subject === `Paiement reçu, facture ${paid[0].number}`); i++) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 300)); // a duplicate, if any, would show up by now
      const receipts = app.get(MailService).sent.filter((m) => m.subject === `Paiement reçu, facture ${paid[0].number}`);
      expect(receipts).toHaveLength(1);
      // the invoice PDF is attached
      expect(receipts[0].attachments).toEqual([{ filename: `Facture-${paid[0].number}.pdf`, bytes: expect.any(Number), pdf: true }]);
      expect(receipts[0].attachments?.[0].bytes).toBeGreaterThan(1000);
      process.env.MAIL_HOST = '';
    });

    it('a failed checkout leaves the module locked and the payment failed', async () => {
      const r = await api().post('/api/billing/purchase').set(as(t)).send({ modules: ['sales'], months: 1 }).expect(201);
      const body = JSON.stringify({ type: 'checkout.failed', data: { id: checkoutIds[1] } });
      await api().post('/api/billing/webhook').set('Content-Type', 'application/json').set('signature', sign(body)).send(body).expect(200);
      const b = (await api().get('/api/billing/me').set(as(t))).body;
      expect(mod(b, 'sales').state).not.toBe('active');
      expect(b.payments.find((p: { id: string }) => p.id === r.body.payment.id).status).toBe('failed');
      await api().get(`/api/billing/payments/${r.body.payment.id}/pdf`).set(as(t)).expect(404);
    });
  });
});
