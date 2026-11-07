// Email one-time codes: mailbox verification at signup and the second factor
// at login. Real app + real Prisma against stockily_test; emails are built by
// MailService in MAIL_HOST=json mode (no network) and the codes are read back
// from the captured messages.
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

process.env.DATABASE_URL = 'postgresql://stockily:stockily@localhost:5432/stockily_test?schema=public';
process.env.APP_DATABASE_URL = 'postgresql://stockily_app:stockily_app@localhost:5432/stockily_test?schema=public';
process.env.MAIL_HOST = 'json';

describe('Email OTP: verification + two-factor (e2e)', () => {
  let app: INestApplication;
  let mailer: { sent: { to: string; subject: string; text?: string }[] };
  let n = 0;
  const api = () => {
    const base = request(app.getHttpServer());
    const ip = () => `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n++ & 255}`;
    return {
      get: (u: string) => base.get(u).set('X-Forwarded-For', ip()),
      post: (u: string) => base.post(u).set('X-Forwarded-For', ip()),
      patch: (u: string) => base.patch(u).set('X-Forwarded-For', ip()),
    };
  };
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const email = `otp-${run}@example.com`;
  const password = 'correct-horse-battery';

  /** Latest code emailed to `to`. */
  const codeFor = (to: string): string => {
    const mail = [...mailer.sent].reverse().find((m) => m.to === to && /est votre code Stockily/.test(m.subject));
    const code = mail?.subject.match(/^(\d{6})/)?.[1];
    if (!code) throw new Error(`no code mailed to ${to}`);
    return code;
  };
  const wrong = (good: string) => (good === '000000' ? '111111' : '000000');
  const tick = () => new Promise((r) => setTimeout(r, 150));

  beforeAll(async () => {
    const { AppModule } = await import('./app/app.module');
    const { MailService } = await import('./modules/mail/mail.service');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    // The per-IP rate limits (5 logins/min) are real protection, but this suite logs in far more often than
    // that: trust X-Forwarded-For and give every request its own address.
    app.getHttpAdapter().getInstance().set('trust proxy', true);
    await app.init();
    mailer = app.get(MailService);
  });
  afterAll(async () => {
    await app.close();
  });

  let challengeId: string;
  let accessToken: string;

  it('signup gives no session: it mails a code to confirm the address', async () => {
    const res = await api().post('/api/auth/signup').send({ organizationName: 'OTP Org', email, password }).expect(201);
    expect(res.body).toMatchObject({ otpRequired: true, purpose: 'verify_email', resendIn: 30 });
    expect(res.body.email).toMatch(/^o\*+@example\.com$/); // masked
    expect(res.body.accessToken).toBeUndefined();
    expect(res.body.refreshToken).toBeUndefined();
    challengeId = res.body.challengeId;
    expect(codeFor(email)).toMatch(/^\d{6}$/);
  });

  it('an unconfirmed account cannot log in with its password alone', async () => {
    const res = await api().post('/api/auth/login').send({ identifier: email, password }).expect(200);
    expect(res.body).toMatchObject({ otpRequired: true, purpose: 'verify_email' });
    expect(res.body.accessToken).toBeUndefined();
    challengeId = res.body.challengeId; // the newest code replaces the older one
  });

  it('refuses a wrong code, counts the attempts, and an old code once replaced', async () => {
    const good = codeFor(email);
    const r = await api().post('/api/auth/otp/verify').send({ challengeId, code: wrong(good) }).expect(401);
    expect(r.body.message).toContain('4 essai');
    await api().post('/api/auth/otp/verify').send({ challengeId: 'not-a-uuid', code: good }).expect(400);
    await api().post('/api/auth/otp/verify').send({ challengeId, code: '12ab56' }).expect(400);
  });

  it('five wrong codes kill the challenge, even for the right code afterwards', async () => {
    const login = await api().post('/api/auth/login').send({ identifier: email, password }).expect(200);
    const good = codeFor(email);
    for (let i = 0; i < 5; i++) await api().post('/api/auth/otp/verify').send({ challengeId: login.body.challengeId, code: wrong(good) }).expect(401);
    await api().post('/api/auth/otp/verify').send({ challengeId: login.body.challengeId, code: good }).expect(401);
    const fresh = await api().post('/api/auth/login').send({ identifier: email, password }).expect(200);
    challengeId = fresh.body.challengeId;
  });

  it('the right code confirms the address, opens a session and sends the welcome email', async () => {
    const res = await api().post('/api/auth/otp/verify').send({ challengeId, code: ` ${codeFor(email)} ` }).expect(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.user.email).toBe(email);
    accessToken = res.body.accessToken;
    await tick();
    expect(mailer.sent.some((m) => m.to === email && m.subject === 'Bienvenue sur Stockily')).toBe(true);
    // single use
    await api().post('/api/auth/otp/verify').send({ challengeId, code: codeFor(email) }).expect(401);
  });

  it('two-factor is on by default: every login needs a fresh code', async () => {
    const acc = await api().get('/api/account').set('Authorization', `Bearer ${accessToken}`).expect(200);
    expect(acc.body).toMatchObject({ email, twoFactorEnabled: true, emailVerified: true });

    const login = await api().post('/api/auth/login').send({ identifier: email, password }).expect(200);
    expect(login.body).toMatchObject({ otpRequired: true, purpose: 'login' });
    expect(login.body.accessToken).toBeUndefined();
    await api().post('/api/auth/login').send({ identifier: email, password: 'nope-nope-nope' }).expect(401); // wrong password never reaches the code step
    const ok = await api().post('/api/auth/otp/verify').send({ challengeId: login.body.challengeId, code: codeFor(email) }).expect(200);
    expect(ok.body.accessToken).toEqual(expect.any(String));
    challengeId = login.body.challengeId;
  });

  it('re-sending waits for the cooldown', async () => {
    const login = await api().post('/api/auth/login').send({ identifier: email, password }).expect(200);
    const r = await api().post('/api/auth/otp/resend').send({ challengeId: login.body.challengeId }).expect(429);
    expect(r.body.message).toMatch(/Patientez/);
  });

  it('turning it off needs the password; then login is direct. Turning it on again restores the code', async () => {
    const auth = { Authorization: `Bearer ${accessToken}` };
    await api().post('/api/account/two-factor').set(auth).send({ enabled: false }).expect(400);
    await api().post('/api/account/two-factor').set(auth).send({ enabled: false, password: 'wrong-password' }).expect(400);
    const off = await api().post('/api/account/two-factor').set(auth).send({ enabled: false, password }).expect(201);
    expect(off.body.twoFactorEnabled).toBe(false);
    const direct = await api().post('/api/auth/login').send({ identifier: email, password }).expect(200);
    expect(direct.body.accessToken).toEqual(expect.any(String));
    await api().post('/api/account/two-factor').set(auth).send({ enabled: true }).expect(201);
    expect((await api().post('/api/auth/login').send({ identifier: email, password }).expect(200)).body.otpRequired).toBe(true);
  });

  it('changing the email address makes the new one prove itself at the next login', async () => {
    const auth = { Authorization: `Bearer ${accessToken}` };
    const next = `otp-new-${run}@example.com`;
    await api().post('/api/account/two-factor').set(auth).send({ enabled: false, password }).expect(201);
    await api().patch('/api/account').set(auth).send({ email: next }).expect(200);
    const login = await api().post('/api/auth/login').send({ identifier: next, password }).expect(200);
    expect(login.body).toMatchObject({ otpRequired: true, purpose: 'verify_email' }); // even with 2FA off
    await api().post('/api/auth/otp/verify').send({ challengeId: login.body.challengeId, code: codeFor(next) }).expect(200);
    expect((await api().post('/api/auth/login').send({ identifier: next, password }).expect(200)).body.accessToken).toEqual(expect.any(String));
  });

  it('a signup that was never confirmed can be claimed again by whoever reads the mailbox', async () => {
    const other = `otp-claim-${run}@example.com`;
    await api().post('/api/auth/signup').send({ organizationName: 'Squat', email: other, password: 'first-password-1' }).expect(201);
    const again = await api().post('/api/auth/signup').send({ organizationName: 'Vrai nom', email: other, password: 'second-password-2' }).expect(201);
    expect(again.body.otpRequired).toBe(true);
    const ok = await api().post('/api/auth/otp/verify').send({ challengeId: again.body.challengeId, code: codeFor(other) }).expect(200);
    expect(ok.body.organization.name).toBe('Vrai nom');
    // …and the password of the first attempt does not work any more; a confirmed address cannot be claimed.
    await api().post('/api/auth/login').send({ identifier: other, password: 'first-password-1' }).expect(401);
    await api().post('/api/auth/signup').send({ organizationName: 'Xx', email: other, password: 'third-password-3' }).expect(409);
  });

  it('without mail delivery configured, signup and login stay direct (offline app, local dev)', async () => {
    process.env.MAIL_HOST = '';
    try {
      const e = `otp-nomail-${run}@example.com`;
      const res = await api().post('/api/auth/signup').send({ organizationName: 'No mail', email: e, password }).expect(201);
      expect(res.body.accessToken).toEqual(expect.any(String));
      expect((await api().post('/api/auth/login').send({ identifier: e, password }).expect(200)).body.accessToken).toEqual(expect.any(String));
    } finally {
      process.env.MAIL_HOST = 'json';
    }
  });
});
