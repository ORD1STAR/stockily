// End-to-end for the platform-admin console (Phase C) against stockily_test.
// Proves cross-tenant access via the superuser client, module grants with
// dependency checks, the read-only-default SQL console with audited writes,
// and that admin and tenant tokens can't cross over.
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import request from 'supertest';

const TEST_DB = 'postgresql://stockily:stockily@localhost:5432/stockily_test?schema=public';
process.env.DATABASE_URL = TEST_DB;
process.env.APP_DATABASE_URL = 'postgresql://stockily_app:stockily_app@localhost:5432/stockily_test?schema=public';

describe('Platform admin e2e', () => {
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const adminEmail = `admin-${Date.now()}@ordi-tech.dz`;
  const adminPassword = 'super-secret-admin-pw';
  const orgEmail = `org-${Date.now()}@example.com`;
  let adminToken: string;
  let tenantToken: string;
  let orgId: string;
  const su = new PrismaClient({ datasourceUrl: TEST_DB });

  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    await su.$connect();
    await su.adminUser.create({ data: { email: adminEmail, name: 'Test Admin', passwordHash: await bcrypt.hash(adminPassword, 10) } });

    const { AppModule } = await import('./app/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    const signup = await api().post('/api/auth/signup').send({ organizationName: 'Org à administrer', email: orgEmail, password: 'correct-horse-battery' }).expect(201);
    tenantToken = signup.body.accessToken;
    orgId = signup.body.organization.id;
  });

  afterAll(async () => {
    await su.$disconnect();
    await app.close();
  });

  it('admin logs in and gets a platform-admin token', async () => {
    const r = await api().post('/api/admin/auth/login').send({ identifier: adminEmail, password: adminPassword }).expect(200);
    expect(r.body.accessToken).toBeTruthy();
    adminToken = r.body.accessToken;
    await api().post('/api/admin/auth/login').send({ identifier: adminEmail, password: 'wrong' }).expect(401);
  });

  it('admin sees organizations cross-tenant (where a normal client would see none)', async () => {
    const r = await api().get('/api/admin/organizations').set(bearer(adminToken)).expect(200);
    expect(r.body.some((o: { id: string }) => o.id === orgId)).toBe(true);
    const dash = await api().get('/api/admin/dashboard').set(bearer(adminToken)).expect(200);
    expect(dash.body.organizations).toBeGreaterThanOrEqual(1);
  });

  it('tenant and admin tokens cannot cross over', async () => {
    await api().get('/api/admin/organizations').set(bearer(tenantToken)).expect(401);
    await api().get('/api/me').set(bearer(adminToken)).expect(401);
    await api().get('/api/admin/organizations').expect(401);
  });

  it('grants a module (cash) and it shows active on the org', async () => {
    await api().post(`/api/admin/organizations/${orgId}/modules/cash`).set(bearer(adminToken)).send({ action: 'activate' }).expect(201);
    const detail = await api().get(`/api/admin/organizations/${orgId}`).set(bearer(adminToken)).expect(200);
    expect(detail.body.modules.find((m: { key: string }) => m.key === 'cash').active).toBe(true);
  });

  it('suggestions: a visitor proposal reaches the admin, who can triage and delete it; tenants cannot read it', async () => {
    const email = `visitor-${Date.now()}@example.com`;
    await api().post('/api/suggestions').send({ email, need: 'Gérer les retours clients par produit.', area: 'sales', priority: 'must_have' }).expect(201);
    await api().get('/api/admin/suggestions').set(bearer(tenantToken)).expect(401);
    const list = await api().get('/api/admin/suggestions').set(bearer(adminToken)).expect(200);
    const row = list.body.find((r: { email: string }) => r.email === email);
    expect(row).toBeTruthy();
    expect(row.status).toBe('new');
    const upd = await api().patch(`/api/admin/suggestions/${row.id}`).set(bearer(adminToken)).send({ status: 'planned', adminNote: 'Prévu au prochain trimestre' }).expect(200);
    expect(upd.body.status).toBe('planned');
    await api().patch(`/api/admin/suggestions/${row.id}`).set(bearer(adminToken)).send({ status: 'bogus' }).expect(400);
    await api().delete(`/api/admin/suggestions/${row.id}`).set(bearer(adminToken)).expect(200);
    await api().delete(`/api/admin/suggestions/${row.id}`).set(bearer(adminToken)).expect(404);
  });

  it('blocks a module whose dependencies are not active, unless forced', async () => {
    // delivery depends on sales (not active for a fresh trial org)
    const blocked = await api().post(`/api/admin/organizations/${orgId}/modules/delivery`).set(bearer(adminToken)).send({ action: 'activate' }).expect(400);
    expect(blocked.body.error).toBe('missing_dependencies');
    expect(blocked.body.missing).toContain('Gestion Ventes');
    await api().post(`/api/admin/organizations/${orgId}/modules/delivery`).set(bearer(adminToken)).send({ action: 'activate', force: true }).expect(201);
  });

  it('SQL console: SELECT runs, a write needs confirmation, and writes are audited', async () => {
    const select = await api().post('/api/admin/sql').set(bearer(adminToken)).send({ sql: `SELECT id, name FROM organizations WHERE id = '${orgId}'` }).expect(201);
    expect(select.body.columns).toEqual(expect.arrayContaining(['id', 'name']));
    expect(select.body.rows[0].id).toBe(orgId);

    // a write inside the default read-only path is rejected by Postgres
    await api().post('/api/admin/sql').set(bearer(adminToken)).send({ sql: `UPDATE organizations SET plan = 'x' WHERE id = '${orgId}'` }).expect(400);
    // write mode requires the exact confirmation phrase
    await api().post('/api/admin/sql').set(bearer(adminToken)).send({ sql: `UPDATE organizations SET plan = 'pro' WHERE id = '${orgId}'`, write: true }).expect(403);
    const wrote = await api()
      .post('/api/admin/sql')
      .set(bearer(adminToken))
      .send({ sql: `UPDATE organizations SET plan = 'pro' WHERE id = '${orgId}'`, write: true, confirm: 'JE CONFIRME' })
      .expect(201);
    expect(wrote.body.rowCount).toBe(1);
    // multi-statement batches are refused
    await api().post('/api/admin/sql').set(bearer(adminToken)).send({ sql: 'SELECT 1; DROP TABLE organizations' }).expect(400);

    const org = await su.organization.findUnique({ where: { id: orgId } });
    expect(org?.plan).toBe('pro');
    const audit = await su.adminAuditLog.findMany({ where: { action: 'sql.write' } });
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });

  it('admin creates a sub-user inside an org (cross-tenant)', async () => {
    const r = await api()
      .post(`/api/admin/organizations/${orgId}/users`)
      .set(bearer(adminToken))
      .send({ username: `adminmade${Date.now()}`, password: 'memberpass', access: { modules: [{ key: 'stock', level: 'view' }], sites: 'all' } })
      .expect(201);
    expect(r.body.id).toBeTruthy();
    const users = await api().get(`/api/admin/organizations/${orgId}/users`).set(bearer(adminToken)).expect(200);
    expect(users.body.some((u: { id: string }) => u.id === r.body.id)).toBe(true);
  });
});
