// Real end-to-end test of Stock + Sites: boots the full AppModule against
// the dedicated `stockily_test` database, same convention as auth.e2e.spec.ts
// (see that file's header comment for why this isn't mocked). Covers what
// the domain-stock unit tests can't: the HTTP/guard-chain layer, and the
// site-scoped-permission behavior that only exists once real Prisma-backed
// roles/sites are involved.
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

process.env.DATABASE_URL = 'postgresql://stockily:stockily@localhost:5432/stockily_test?schema=public';

describe('Stock + Sites e2e', () => {
  let app: INestApplication;
  let prisma: import('@prisma/client').PrismaClient;

  const email = `stock-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const password = 'correct-horse-battery';
  let accessToken: string;
  let orgId: string;
  let siteAId: string;
  let siteBId: string;
  let productId: string;

  beforeAll(async () => {
    const { AppModule } = await import('./app/app.module');
    const { PrismaService } = await import('./prisma/prisma.service');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const signup = await request(app.getHttpServer())
      .post('/api/auth/signup')
      .send({ organizationName: 'Stock E2E Org', email, password })
      .expect(201);
    accessToken = signup.body.accessToken;
    orgId = signup.body.organization.id;

    const siteA = await request(app.getHttpServer())
      .post('/api/sites')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Site A' })
      .expect(201);
    const siteB = await request(app.getHttpServer())
      .post('/api/sites')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Site B' })
      .expect(201);
    siteAId = siteA.body.id;
    siteBId = siteB.body.id;

    const product = await request(app.getHttpServer())
      .post('/api/stock/products')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ sku: `SKU-${Date.now()}`, name: 'Test Product', isLotTracked: false, minThreshold: 10 })
      .expect(201);
    productId = product.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a duplicate SKU within the same org', async () => {
    const first = await request(app.getHttpServer())
      .post('/api/stock/products')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ sku: 'DUP-SKU', name: 'First' })
      .expect(201);
    expect(first.body.sku).toBe('DUP-SKU');

    await request(app.getHttpServer())
      .post('/api/stock/products')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ sku: 'DUP-SKU', name: 'Second' })
      .expect(409);
  });

  it('posts an IN movement and updates the stock level, visible via GET /stock/products', async () => {
    await request(app.getHttpServer())
      .post('/api/stock/movements')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ productId, siteId: siteAId, type: 'IN', quantity: 50, unitCost: 10 })
      .expect(201);

    const list = await request(app.getHttpServer())
      .get(`/api/stock/products?siteId=${siteAId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const row = list.body.find((r: { productId: string }) => r.productId === productId);
    expect(row).toBeDefined();
    expect(row.quantityOnHand).toBe(50);
    expect(row.averageCost).toBe(10);
  });

  it('rejects an OUT movement that would take stock negative', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/stock/movements')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ productId, siteId: siteAId, type: 'OUT', quantity: 999 })
      .expect(400);

    expect(res.body.error).toBe('negative_stock');
  });

  it('creates a transfer that moves both legs of the ledger atomically', async () => {
    const transfer = await request(app.getHttpServer())
      .post('/api/sites/transfers')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ productId, fromSiteId: siteAId, toSiteId: siteBId, quantity: 20 })
      .expect(201);
    expect(transfer.body.status).toBe('in_transit');

    const list = await request(app.getHttpServer())
      .get('/api/stock/products?siteId=all')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const siteARow = list.body.find((r: { productId: string; site: { id: string } }) => r.productId === productId && r.site.id === siteAId);
    const siteBRow = list.body.find((r: { productId: string; site: { id: string } }) => r.productId === productId && r.site.id === siteBId);
    expect(siteARow.quantityOnHand).toBe(30); // 50 - 20
    expect(siteBRow.quantityOnHand).toBe(20);
  });

  it('updates a transfer with driver info and a status transition', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/sites/transfers')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ productId, fromSiteId: siteBId, toSiteId: siteAId, quantity: 5 })
      .expect(201);

    const updated = await request(app.getHttpServer())
      .patch(`/api/sites/transfers/${created.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ status: 'delivered', driverName: 'Test Driver', vehicleRef: 'AB-123' })
      .expect(200);

    expect(updated.body.status).toBe('delivered');
    expect(updated.body.driverName).toBe('Test Driver');
  });

  describe('site-scoped permissions (Opérateur Entrepôt confined to one site)', () => {
    let scopedEmail: string;
    let scopedAccessToken: string;

    beforeAll(async () => {
      // No user-management endpoint exists yet (out of Milestone 2 scope) —
      // create the second user's account and role assignment directly via
      // Prisma, same pattern auth.e2e.spec.ts's sibling test used in
      // Milestone 1 for edge cases the HTTP surface can't reach yet.
      scopedEmail = `scoped-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
      const bcrypt = await import('bcryptjs');
      const passwordHash = await bcrypt.hash(password, 4); // low cost factor — test speed, not security
      const scopedUser = await prisma.user.create({ data: { orgId, email: scopedEmail, passwordHash } });

      const opRole = await prisma.role.findFirstOrThrow({ where: { name: 'Opérateur Entrepôt', isSystem: true } });
      await prisma.userRole.create({ data: { userId: scopedUser.id, roleId: opRole.id, siteId: siteAId } });

      const login = await request(app.getHttpServer()).post('/api/auth/login').send({ email: scopedEmail, password }).expect(200);
      scopedAccessToken = login.body.accessToken;
    });

    it('allows a movement at the site the user is scoped to', async () => {
      await request(app.getHttpServer())
        .post('/api/stock/movements')
        .set('Authorization', `Bearer ${scopedAccessToken}`)
        .send({ productId, siteId: siteAId, type: 'IN', quantity: 1, unitCost: 10 })
        .expect(201);
    });

    it('rejects a movement at a site the user is NOT scoped to', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/stock/movements')
        .set('Authorization', `Bearer ${scopedAccessToken}`)
        .send({ productId, siteId: siteBId, type: 'IN', quantity: 1, unitCost: 10 })
        .expect(403);

      // PermissionGuard's own combined user+site+permission query already
      // finds zero matching roles for this (user, site B) pair and rejects
      // — SiteScopeGuard, which runs after it, is never reached. That's the
      // intended chain behavior (permission.guard.ts's own comment: site
      // scoping is folded into the SAME query as the permission check,
      // specifically to avoid an unsound two-independent-checks
      // decomposition), not a bug — `site_scope_denied` is what a route
      // would produce if it had no @RequiresPermission at all.
      expect(res.body.error).toBe('permission_denied');
    });

    it('an all-sites list request is narrowed to only the site the user is scoped to, not the whole org', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/stock/products?siteId=all')
        .set('Authorization', `Bearer ${scopedAccessToken}`)
        .expect(200);

      const siteIdsSeen = new Set(res.body.map((r: { site: { id: string } }) => r.site.id));
      expect(siteIdsSeen.has(siteAId)).toBe(true);
      expect(siteIdsSeen.has(siteBId)).toBe(false);
    });
  });
});
