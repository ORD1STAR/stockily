// End-to-end test of the device sync API: user sessions for replay, number
// blocks, replayed numbering, idempotency, and the org snapshot — against
// the real `stockily_test` database (same setup as auth.e2e.spec.ts).
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';

process.env.DATABASE_URL = 'postgresql://stockily:stockily@localhost:5432/stockily_test?schema=public';
process.env.APP_DATABASE_URL = 'postgresql://stockily_app:stockily_app@localhost:5432/stockily_test?schema=public';

const h = () => createHash('sha256').update(randomBytes(16)).digest('hex');

describe('Sync e2e', () => {
  let app: INestApplication;
  let token: string;
  let userId: string;
  let license: string;
  let siteId: string;
  let block: { start: number; end: number; year: number };
  const email = `sync-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const api = () => request(app.getHttpServer());

  const proforma = (key: string, value: number, year = block.year) =>
    api()
      .post('/api/invoicing/invoices')
      .set('Authorization', `Bearer ${token}`)
      .set('x-stockily-license', license)
      .set('x-stockily-idempotency-key', key)
      .set('x-stockily-replay-numbers', JSON.stringify([{ key: 'doc:proforma', year, value }]))
      .send({ type: 'CUSTOMER', kind: 'proforma', siteId, lines: [{ description: 'Article test', quantity: 2, unitPrice: 100 }] });

  beforeAll(async () => {
    const { AppModule } = await import('./app/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    const signup = await api().post('/api/auth/signup').send({ organizationName: 'Sync Org', email, password: 'correct-horse-battery' }).expect(201);
    token = signup.body.accessToken;
    userId = signup.body.user.id;
    const act = await api().post('/api/licensing/activate').set('Authorization', `Bearer ${token}`).send({ motherboardHash: h(), diskHash: h(), macHash: h() }).expect(200);
    license = act.body.licenseToken;
    const sites = await api().get('/api/sites').set('Authorization', `Bearer ${token}`).expect(200);
    siteId = sites.body[0].id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('device endpoints require a valid license', async () => {
    await api().get('/api/sync/snapshot').expect(401);
    await api().get('/api/sync/snapshot').set('x-stockily-license', 'garbage').expect(401);
  });

  it('issues a user session for replay, only for users of the device org', async () => {
    const ok = await api().post('/api/sync/session').set('x-stockily-license', license).send({ userId }).expect(200);
    expect(ok.body.accessToken).toBeTruthy();
    await api().post('/api/sync/session').set('x-stockily-license', license).send({ userId: randomUUID() }).expect(403);
  });

  it('reserves a block of numbers and bumps the org counter past it', async () => {
    const res = await api().post('/api/sync/number-blocks').set('x-stockily-license', license).send({ counterKey: 'doc:proforma', size: 20 }).expect(201);
    block = res.body;
    expect(block.end - block.start).toBe(19);
    // A normal web request now numbers after the block, never inside it.
    const web = await api()
      .post('/api/invoicing/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'CUSTOMER', kind: 'proforma', siteId, lines: [{ description: 'Web', quantity: 1, unitPrice: 10 }] })
      .expect(201);
    expect(Number(web.body.number.split('-')[2])).toBe(block.end + 1);
  });

  it('a replay reuses the number the device printed offline', async () => {
    const res = await proforma(randomUUID(), block.start + 3).expect(201);
    expect(res.body.number).toBe(`PF-${block.year}-${String(block.start + 3).padStart(6, '0')}`);
  });

  it('a retried replay is answered from the log, not applied twice', async () => {
    const key = randomUUID();
    const first = await proforma(key, block.start + 4).expect(201);
    // The idempotency record is written on response-finish; a real device
    // retries after a timeout (seconds), never in the same millisecond, so
    // wait for it to persist before retrying (otherwise, under heavy parallel
    // test load, the two can race).
    await new Promise((r) => setTimeout(r, 800));
    const again = await proforma(key, block.start + 4).expect(201);
    expect(again.headers['x-stockily-replayed']).toBe('1');
    expect(again.body.id).toBe(first.body.id);
    const list = await api().get('/api/invoicing/invoices?status=proforma').set('Authorization', `Bearer ${token}`).expect(200);
    expect(list.body.filter((i: { number: string }) => i.number === first.body.number)).toHaveLength(1);
  });

  it('rejects a number outside the device blocks, and logs the failure', async () => {
    const res = await proforma(randomUUID(), block.end + 500).expect(409);
    expect(res.body.error).toBe('number_out_of_block');
    await new Promise((r) => setTimeout(r, 300)); // replay log is written on response finish
    const failed = await api().get('/api/sync/replays?status=failed').set('Authorization', `Bearer ${token}`).expect(200);
    expect(failed.body.length).toBeGreaterThanOrEqual(1);
    expect(failed.body[0].httpStatus).toBe(409);
  });

  it('the snapshot carries the org data, scoped to this org only', async () => {
    const res = await api().get('/api/sync/snapshot').set('x-stockily-license', license).expect(200);
    const m = res.body.models;
    expect(m.Organization).toHaveLength(1);
    expect(m.User.map((u: { email: string }) => u.email)).toEqual([email]);
    expect(m.Site.every((s: { orgId: string }) => s.orgId === res.body.orgId)).toBe(true);
    expect(m.Invoice.length).toBeGreaterThanOrEqual(3);
    expect(m.InvoiceLine.length).toBeGreaterThanOrEqual(3);
    expect(m.Module.length).toBeGreaterThan(5);
    expect(m.RolePermission.length).toBeGreaterThan(0);
    expect(m.RefreshToken).toBeUndefined();
    expect(m.AuditLog).toBeUndefined();
    expect(res.body.numberBlocks).toHaveLength(1);
  });
});
