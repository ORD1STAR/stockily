// Downloads and auto-update endpoints: boots only ReleasesModule (no database)
// against a temp releases directory built by the real publish script.
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { ReleasesModule } from './modules/releases/releases.module';

const SCRIPT = join(__dirname, '../../desktop/scripts/publish-release.mjs');

describe('Releases (downloads + auto-update)', () => {
  let app: INestApplication;
  let dir: string;
  let build: string;
  const api = () => request(app.getHttpServer());

  const publish = (version: string, body: string, notes = '') => {
    const exe = join(build, `Stockily_${version}_x64-setup.exe`);
    writeFileSync(exe, body);
    writeFileSync(`${exe}.sig`, `SIGNATURE-OF-${version}\n`);
    execFileSync('node', [SCRIPT, exe, '--notes', notes, '--dir', dir]);
    return exe;
  };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'stk-releases-'));
    build = mkdtempSync(join(tmpdir(), 'stk-build-'));
    process.env.RELEASES_DIR = dir;
    process.env.PUBLIC_APP_URL = 'https://example.test';
    const mod = await Test.createTestingModule({ imports: [ReleasesModule] }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });
  afterAll(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(build, { recursive: true, force: true });
  });

  it('with nothing published: not available, nothing to download, no update', async () => {
    const o = await api().get('/api/downloads').expect(200);
    expect(o.body).toEqual([{ platform: 'windows', available: false }, { platform: 'linux', available: false }]);
    await api().get('/api/downloads/windows/latest').expect(404);
    await api().get('/api/updates/windows/x86_64/0.1.0').expect(204);
  });

  it('serves the latest installer with its checksum, resumable', async () => {
    publish('0.1.0', 'OLD-INSTALLER-BYTES');
    publish('0.2.0', 'NEW-INSTALLER-BYTES-0123456789', 'Nouveautés');
    await new Promise((r) => setTimeout(r, 5_100)); // the API re-reads the manifest every 5 s
    const o = (await api().get('/api/downloads').expect(200)).body[0];
    expect(o).toMatchObject({ available: true, version: '0.2.0', fileName: 'Stockily_0.2.0_x64-setup.exe', notes: 'Nouveautés' });
    expect(o.sha256).toMatch(/^[0-9a-f]{64}$/);

    const res = await api().get('/api/downloads/windows/latest').buffer().parse((r, cb) => {
      const c: Buffer[] = [];
      r.on('data', (d: Buffer) => c.push(d));
      r.on('end', () => cb(null, Buffer.concat(c)));
    });
    expect(res.status).toBe(200);
    expect(res.body.toString()).toBe('NEW-INSTALLER-BYTES-0123456789');
    expect(res.headers['content-disposition']).toBe('attachment; filename="Stockily_0.2.0_x64-setup.exe"');
    expect(res.headers['content-type']).toContain('application/octet-stream');
    expect(res.headers['x-checksum-sha256']).toBe(o.sha256);
    const part = await api().get('/api/downloads/windows/0.2.0').set('Range', 'bytes=0-3').expect(206);
    expect(part.headers['content-range']).toMatch(/^bytes 0-3\//);
    await api().get('/api/downloads/windows/0.1.0').expect(200); // older numbered versions stay downloadable
  });

  it('accepts no path, no unknown platform, no malformed version', async () => {
    for (const bad of ['../manifest.json', '..%2Fmanifest.json', '%2e%2e%2fmanifest.json', 'Stockily_0.2.0_x64-setup.exe', '0.2', '0.2.0.0', 'latest%00', '9.9.9']) {
      const r = await api().get(`/api/downloads/windows/${bad}`);
      expect([400, 404]).toContain(r.status);
    }
    for (const platform of ['macos', '..', 'manifest.json']) await api().get(`/api/downloads/${platform}/latest`).expect(404);
  });

  it('refuses a file that changed on disk after publication, and a symlink', async () => {
    const dest = join(dir, 'Stockily_0.2.0_x64-setup.exe');
    const good = readFileSync(dest);
    appendFileSync(dest, 'X'); // size no longer matches the manifest
    await new Promise((r) => setTimeout(r, 5_100)); // manifest cache
    await api().get('/api/downloads/windows/0.2.0').expect(404);
    expect(await api().get('/api/updates/windows/x86_64/0.1.0')).toHaveProperty('status', 204); // never announces an unservable file

    writeFileSync(dest, Buffer.from(good.toString().replace('NEW', 'EVL'))); // same size, different content
    await api().get('/api/downloads/windows/0.2.0').expect(404);

    unlinkSync(dest);
    writeFileSync(join(dir, 'secret.txt'), 'x'.repeat(good.length));
    symlinkSync(join(dir, 'secret.txt'), dest);
    await api().get('/api/downloads/windows/0.2.0').expect(404);
    unlinkSync(dest);
    writeFileSync(dest, good); // restore
  });

  it('ignores manifest entries with a hostile file name', async () => {
    const mpath = join(dir, 'manifest.json');
    const m = JSON.parse(readFileSync(mpath, 'utf8'));
    m.releases.push({ platform: 'windows', version: '9.0.0', file: '../../etc/passwd', sha256: 'a'.repeat(64), size: 5, signature: 's', notes: '', publishedAt: new Date().toISOString() });
    writeFileSync(mpath, JSON.stringify(m));
    await new Promise((r) => setTimeout(r, 5_100));
    expect((await api().get('/api/downloads').expect(200)).body[0].version).toBe('0.2.0');
  });

  it('tells old apps about the update (Tauri format) and leaves current ones alone', async () => {
    const u = await api().get('/api/updates/windows/x86_64/0.1.0').expect(200);
    expect(u.body).toMatchObject({ version: '0.2.0', notes: 'Nouveautés', url: 'https://example.test/api/downloads/windows/0.2.0', signature: 'SIGNATURE-OF-0.2.0' });
    await api().get('/api/updates/windows/x86_64/0.2.0').expect(204);
    await api().get('/api/updates/windows/x86_64/1.0.0').expect(204);
    await api().get('/api/updates/windows/x86_64/not-a-version').expect(204);
    await api().get('/api/updates/macos/x86_64/0.1.0').expect(204);
    await api().get('/api/updates/linux/x86_64/0.1.0').expect(204); // nothing published for Linux
    await api().get('/api/updates/windows/arm64/0.1.0').expect(204);
  });

  it('publishes and serves the Linux AppImage on its own track', async () => {
    const f = join(build, 'Stockily_0.2.0_amd64.AppImage');
    writeFileSync(f, 'LINUX-APPIMAGE-BYTES');
    writeFileSync(`${f}.sig`, 'LINUX-SIG-0.2.0\n');
    execFileSync('node', [SCRIPT, f, '--notes', 'Linux', '--dir', dir]);
    await new Promise((r) => setTimeout(r, 5_100));
    const o = (await api().get('/api/downloads').expect(200)).body.find((d: { platform: string }) => d.platform === 'linux');
    expect(o).toMatchObject({ available: true, version: '0.2.0', fileName: 'Stockily_0.2.0_amd64.AppImage' });
    const res = await api().get('/api/downloads/linux/latest').buffer().parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c)).on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(res.headers['content-disposition']).toContain('Stockily_0.2.0_amd64.AppImage');
    expect((res.body as Buffer).toString()).toBe('LINUX-APPIMAGE-BYTES');
    const u = await api().get('/api/updates/linux/x86_64/0.1.0').expect(200);
    expect(u.body).toMatchObject({ version: '0.2.0', url: 'https://example.test/api/downloads/linux/0.2.0', signature: 'LINUX-SIG-0.2.0' });
    // The Windows track is untouched, and a Windows file name is not accepted as a Linux release.
    expect((await api().get('/api/updates/windows/x86_64/0.1.0').expect(200)).body.url).toContain('/windows/0.2.0');
    await api().get('/api/downloads/linux/9.9.9').expect(404);
  });

  describe('light updates', () => {
    const BASE = 'b'.repeat(64);
    const publishLight = (version: string, baseId: string, body = 'LIGHT-ZIP-BYTES') => {
      const exe = publish(version, `FULL-${version}`);
      const zip = join(build, `Stockily_${version}_light-windows.zip`);
      writeFileSync(zip, body);
      writeFileSync(`${zip}.sig`, `LIGHT-SIG-${version}\n`);
      execFileSync('node', [SCRIPT, exe, '--notes', 'Léger', '--dir', dir, '--light', zip, '--base-id', baseId]);
      return zip;
    };
    const wait = () => new Promise((r) => setTimeout(r, 5_100)); // manifest cache
    const plan = (base: string, current: string) => api().get(`/api/updates/light/windows/x86_64/${base}/${current}`).expect(200).then((r) => r.body);

    it('same base: the small zip; other base: the full installer; up to date: nothing', async () => {
      publishLight('0.7.0', BASE);
      await wait();
      const p = await plan(BASE, '0.6.0');
      expect(p).toMatchObject({ mode: 'light', version: '0.7.0', url: 'https://example.test/api/downloads/windows/0.7.0/light', signature: 'LIGHT-SIG-0.7.0', size: 15 });
      expect(p.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(await plan('c'.repeat(64), '0.6.0')).toEqual({ mode: 'full' }); // base changed: needs the installer
      expect(await plan(BASE, '0.7.0')).toEqual({ mode: 'none' });
      expect(await plan(BASE, '9.0.0')).toEqual({ mode: 'none' });
      // a malformed request is never an error, just "nothing"
      expect(await plan('short', '0.6.0')).toEqual({ mode: 'none' });
      expect(await plan(BASE, 'not-a-version')).toEqual({ mode: 'none' });
    });

    it('serves the light zip with its checksum; the same hostile requests as for installers are 404', async () => {
      const res = await api().get('/api/downloads/windows/0.7.0/light').buffer().parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c)).on('end', () => cb(null, Buffer.concat(chunks)));
      }).expect(200);
      expect(res.headers['content-type']).toContain('application/zip');
      expect(res.headers['content-disposition']).toContain('Stockily_0.7.0_light-windows.zip');
      expect((res.body as Buffer).toString()).toBe('LIGHT-ZIP-BYTES');
      await api().get('/api/downloads/windows/..%2f..%2fmanifest.json/light').expect(404);
      await api().get('/api/downloads/windows/0.6.9/light').expect(404); // that release has no light part
      await api().get('/api/downloads/macos/0.7.0/light').expect(404);
    });

    it('a swapped or corrupted light zip is never offered nor served', async () => {
      writeFileSync(join(dir, 'Stockily_0.7.0_light-windows.zip'), 'TAMPERED-BYTES!'); // same size, other content
      await wait();
      await api().get('/api/downloads/windows/0.7.0/light').expect(404);
      expect(await plan(BASE, '0.6.0')).toEqual({ mode: 'full' }); // falls back to the full installer
    });

    it('refuses to publish a light zip without a base id or with a wrong name', () => {
      const exe = publish('0.8.0', 'FULL-0.8.0');
      const zip = join(build, 'Stockily_0.8.0_light-windows.zip');
      writeFileSync(zip, 'x');
      writeFileSync(`${zip}.sig`, 'sig');
      expect(() => execFileSync('node', [SCRIPT, exe, '--dir', dir, '--light', zip], { stdio: 'pipe' })).toThrow();
      const wrong = join(build, 'whatever.zip');
      writeFileSync(wrong, 'x');
      writeFileSync(`${wrong}.sig`, 'sig');
      expect(() => execFileSync('node', [SCRIPT, exe, '--dir', dir, '--light', wrong, '--base-id', BASE], { stdio: 'pipe' })).toThrow();
    });
  });
});
