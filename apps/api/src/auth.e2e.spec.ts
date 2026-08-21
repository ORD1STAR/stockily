// Real end-to-end test of the auth/tenancy flow: boots the full AppModule
// (real guards, real Prisma, real bcrypt/JWT — nothing mocked) against a
// dedicated `stockily_test` database on the same docker-compose Postgres
// instance. This milestone IS the tenancy/permission logic, so mocking the
// DB away would test nothing meaningful about it — see docs/MILESTONE_1.md
// for the full rationale and the one-time setup step
// (`npm run test:e2e:db:setup`) this test assumes has already been run.
//
// AppModule (and anything importing it) is dynamically imported, not
// statically, specifically so DATABASE_URL can be overridden below BEFORE
// PrismaService's `new PrismaClient()` call ever executes — a static
// top-of-file import would be hoisted above that reassignment and would
// have already read (or been influenced by) the wrong URL.
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

process.env.DATABASE_URL = 'postgresql://stockily:stockily@localhost:5432/stockily_test?schema=public';

describe('Auth/Tenancy e2e', () => {
  let app: INestApplication;

  // Unique per run rather than truncating the test DB between runs —
  // simplest way to keep this test repeatable without extra DB-cleanup
  // machinery (a deliberate test-DB-strategy choice, not an oversight).
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const password = 'correct-horse-battery';
  let accessToken: string;
  let refreshToken: string;

  beforeAll(async () => {
    const { AppModule } = await import('./app/app.module');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('signs up and auto-issues a working token pair', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/signup')
      .send({ organizationName: 'E2E Test Org', email, password })
      .expect(201);

    expect(res.body.organization.name).toBe('E2E Test Org');
    expect(res.body.user.email).toBe(email);
    expect(typeof res.body.accessToken).toBe('string');
    expect(typeof res.body.refreshToken).toBe('string');

    accessToken = res.body.accessToken;
    refreshToken = res.body.refreshToken;
  });

  it('rejects signup with an email already in use', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/signup')
      .send({ organizationName: 'Another Org', email, password })
      .expect(409);
  });

  it('rejects login with the wrong password (same error as a nonexistent user)', async () => {
    const wrongPw = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password: 'wrong' });
    const noSuchUser = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password });

    expect(wrongPw.status).toBe(401);
    expect(noSuchUser.status).toBe(401);
    expect(wrongPw.body.message).toBe(noSuchUser.body.message);
  });

  it('GET /me returns the trial entitlements for all 5 Phase 1 modules and the Super Admin role', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.user.email).toBe(email);
    expect(res.body.roles).toEqual(expect.arrayContaining([{ role: 'Super Admin', site: null }]));
    expect(res.body.entitlements).toHaveLength(5);
    expect(res.body.entitlements.map((e: { module: string }) => e.module).sort()).toEqual([
      'invoicing',
      'quality',
      'scan',
      'sites',
      'stock',
    ]);
    expect(res.body.entitlements.every((e: { status: string }) => e.status === 'trial')).toBe(true);
  });

  it('rejects GET /me with no token, and with a garbage token', async () => {
    await request(app.getHttpServer()).get('/api/me').expect(401);
    await request(app.getHttpServer()).get('/api/me').set('Authorization', 'Bearer garbage').expect(401);
  });

  it('the guard chain allows a site-scoped demo route for an org-wide role', async () => {
    await request(app.getHttpServer())
      .get('/api/demo/stock-access/any-site-id-at-all')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
  });

  it('rotates the refresh token on use, and rejects the pre-rotation token on replay', async () => {
    const res = await request(app.getHttpServer()).post('/api/auth/refresh').send({ refreshToken }).expect(200);

    const rotated = res.body.refreshToken;
    expect(rotated).not.toBe(refreshToken);

    await request(app.getHttpServer()).post('/api/auth/refresh').send({ refreshToken }).expect(401);

    refreshToken = rotated;
    accessToken = res.body.accessToken;
  });

  it('logout-everywhere revokes every live refresh token for the user, not just the current one', async () => {
    // A second "device" session for the same user.
    const secondLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password })
      .expect(200);
    const secondDeviceRefreshToken = secondLogin.body.refreshToken;

    await request(app.getHttpServer())
      .post('/api/auth/logout-everywhere')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);

    await request(app.getHttpServer()).post('/api/auth/refresh').send({ refreshToken }).expect(401);
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: secondDeviceRefreshToken })
      .expect(401);
  });

  it('logout is idempotent and never reveals whether a token was ever valid', async () => {
    await request(app.getHttpServer()).post('/api/auth/logout').send({ refreshToken: 'never-existed' }).expect(204);
    await request(app.getHttpServer()).post('/api/auth/logout').send({ refreshToken }).expect(204);
  });
});
