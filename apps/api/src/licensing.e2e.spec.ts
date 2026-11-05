// Real end-to-end test of desktop-device licensing (seat cap, fuzzy
// fingerprint reuse, renew/release, admin deactivate) against the
// `stockily_test` database — same setup and rationale as auth.e2e.spec.ts.
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash, randomBytes } from 'node:crypto';
import request from 'supertest';

process.env.DATABASE_URL = 'postgresql://stockily:stockily@localhost:5432/stockily_test?schema=public';
process.env.APP_DATABASE_URL = 'postgresql://stockily_app:stockily_app@localhost:5432/stockily_test?schema=public';

const h = () => createHash('sha256').update(randomBytes(16)).digest('hex');
const machine = () => ({ motherboardHash: h(), diskHash: h(), macHash: h() });

describe('Licensing e2e', () => {
  let app: INestApplication;
  let token: string;
  const email = `lic-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const pcA = machine();
  let licenseA: string;

  const api = () => request(app.getHttpServer());
  const activate = (fp: object, label?: string) =>
    api().post('/api/licensing/activate').set('Authorization', `Bearer ${token}`).send({ ...fp, deviceLabel: label });

  beforeAll(async () => {
    const { AppModule } = await import('./app/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    const res = await api().post('/api/auth/signup').send({ organizationName: 'Licensing Org', email, password: 'correct-horse-battery' }).expect(201);
    token = res.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('activates a new device and returns a signed license', async () => {
    const res = await activate(pcA, 'Comptoir 1').expect(200);
    expect(res.body.isNewDevice).toBe(true);
    expect(res.body.licenseToken.split('.')).toHaveLength(3);
    const days = (new Date(res.body.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(44);
    expect(days).toBeLessThanOrEqual(45);
    licenseA = res.body.licenseToken;
  });

  it('re-activating the same machine renews in place without a new seat', async () => {
    const res = await activate(pcA).expect(200);
    expect(res.body.isNewDevice).toBe(false);
    const list = await api().get('/api/licensing/devices').set('Authorization', `Bearer ${token}`).expect(200);
    expect(list.body.seats).toMatchObject({ used: 1, total: 3, seatsPerSite: 3, sites: 1 });
  });

  it('a disk swap (2 of 3 components unchanged) keeps the same seat', async () => {
    const res = await activate({ ...pcA, diskHash: h() }).expect(200);
    expect(res.body.isNewDevice).toBe(false);
    const list = await api().get('/api/licensing/devices').set('Authorization', `Bearer ${token}`).expect(200);
    expect(list.body.devices).toHaveLength(1);
    expect(list.body.devices[0].reactivationCount).toBe(1);
  });

  it('enforces the seat cap (1 site × 3 seats)', async () => {
    await activate(machine()).expect(200);
    await activate(machine()).expect(200);
    const res = await activate(machine()).expect(403);
    expect(res.body).toMatchObject({ error: 'seats_exhausted', used: 3, total: 3 });
  });

  it('admin deactivation frees a seat immediately (no cooldown)', async () => {
    const list = await api().get('/api/licensing/devices').set('Authorization', `Bearer ${token}`).expect(200);
    const victim = list.body.devices.find((d: { deviceLabel: string | null }) => d.deviceLabel !== 'Comptoir 1');
    await api().post(`/api/licensing/devices/${victim.id}/deactivate`).set('Authorization', `Bearer ${token}`).expect(200);
    await activate(machine()).expect(200);
  });

  it('renews only with the right hardware, and rejects a tampered token', async () => {
    const fresh = machine();
    // free a seat, then license `fresh`
    const list = await api().get('/api/licensing/devices').set('Authorization', `Bearer ${token}`).expect(200);
    const other = list.body.devices.find((d: { status: string; deviceLabel: string | null }) => d.status === 'active' && d.deviceLabel !== 'Comptoir 1');
    await api().post(`/api/licensing/devices/${other.id}/deactivate`).set('Authorization', `Bearer ${token}`).expect(200);
    const lic = (await activate(fresh).expect(200)).body.licenseToken;

    const ok = await api().post('/api/licensing/renew').send({ licenseToken: lic, ...fresh }).expect(200);
    expect(ok.body.licenseToken).toBeTruthy();

    const wrongHw = await api().post('/api/licensing/renew').send({ licenseToken: lic, ...machine() }).expect(401);
    expect(wrongHw.body.error).toBe('fingerprint_mismatch');

    const [head, body, sig] = lic.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), orgId: 'someone-else' })).toString('base64url');
    await api().post('/api/licensing/renew').send({ licenseToken: `${head}.${forged}.${sig}`, ...fresh }).expect(401);

    // the device releases its own seat; its license then stops renewing
    await api().post('/api/licensing/release').send({ licenseToken: lic, ...fresh }).expect(200);
    const after = await api().post('/api/licensing/renew').send({ licenseToken: lic, ...fresh }).expect(401);
    expect(after.body.error).toBe('device_deactivated');
  });

  it('the old license of a re-fingerprinted machine no longer renews', async () => {
    await api().post('/api/licensing/renew').send({ licenseToken: licenseA, ...machine() }).expect(401);
  });

  it('device management requires licensing.device.manage', async () => {
    await api().get('/api/licensing/devices').expect(401);
  });
});
