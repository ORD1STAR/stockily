// In-app purchase plumbing of the desktop app: the public catalog is reachable without a
// session, and only Stockily's / Chargily's https pages can be opened in the system browser.
import { BadRequestException } from '@nestjs/common';
import { LocalController } from './local.controller';
import { LocalUpdateService } from './local-update.service';
import { OnlineOnlyMiddleware } from './online-only.middleware';

describe('Desktop purchase plumbing', () => {
  beforeEach(() => {
    process.env.STOCKILY_REMOTE_ORIGIN = 'https://stockily.example.test';
  });

  describe('open-external', () => {
    const updates = new LocalUpdateService();
    const controller = new LocalController({} as never, {} as never, updates);

    it.each(['https://pay.chargily.net/test/checkouts/abc', 'https://pay.chargily.dz/test/checkouts/abc', 'https://stockily.example.test/compte?tab=payments'])('queues %s for the shell', (url) => {
      expect(controller.openExternal({ url })).toEqual({ opened: true });
      expect(updates.takeOpen()).toBe(new URL(url).toString());
      expect(updates.takeOpen()).toBeNull(); // handed over once
    });

    it('upgrades the http:// links Chargily hands out to https', () => {
      controller.openExternal({ url: 'http://pay.chargily.dz/test/checkouts/xyz' });
      expect(updates.takeOpen()).toBe('https://pay.chargily.dz/test/checkouts/xyz');
    });

    it.each([
      'http://evil.example.com/x', // other host, even over http
      'https://evil.example.com/pay', // other host
      'https://pay.chargily.net.evil.com/x', // look-alike host
      'file:///C:/Windows/System32/calc.exe',
      'javascript:alert(1)',
      'not a url',
    ])('refuses %s', (url) => {
      expect(() => controller.openExternal({ url })).toThrow(BadRequestException);
      expect(updates.takeOpen()).toBeNull();
    });
  });

  describe('public catalog through the device', () => {
    const state = { online: true } as never;
    const sync = { remoteTokenFor: jest.fn(async () => 'REMOTE'), requestPull: jest.fn() } as never;
    const jwt = { verify: jest.fn(() => { throw new Error('no session'); }) } as never;
    const mw = new OnlineOnlyMiddleware(state, sync, jwt);
    const res = () => {
      const r: Record<string, jest.Mock> = {};
      r.status = jest.fn(() => r);
      r.json = jest.fn(() => r);
      r.send = jest.fn(() => r);
      r.setHeader = jest.fn(() => r);
      return r;
    };

    it('forwards /api/billing/catalog without any session (no "Jeton invalide")', async () => {
      const fetchMock = jest.fn(async () => new Response(JSON.stringify({ modules: [] }), { status: 200, headers: { 'content-type': 'application/json' } }));
      const real = global.fetch;
      global.fetch = fetchMock as never;
      try {
        const r = res();
        await mw.use({ originalUrl: '/api/billing/catalog', method: 'GET', headers: {} } as never, r as never, jest.fn());
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
        expect(url).toBe('https://stockily.example.test/api/billing/catalog');
        expect(init.headers.Authorization).toBeUndefined();
        expect(r.status).toHaveBeenCalledWith(200);
      } finally {
        global.fetch = real;
      }
    });

    it('still requires a session for the rest of the Espace client', async () => {
      const r = res();
      await mw.use({ originalUrl: '/api/billing/me', method: 'GET', headers: {} } as never, r as never, jest.fn());
      expect(r.status).toHaveBeenCalledWith(401);
    });
  });
});
