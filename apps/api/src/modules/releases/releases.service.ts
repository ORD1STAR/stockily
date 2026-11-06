import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const PLATFORMS = ['windows', 'linux'] as const;
export type Platform = (typeof PLATFORMS)[number];

/** The one file name allowed per platform and version (Windows installer / Linux AppImage). */
export const fileNameFor = (platform: Platform, version: string) =>
  platform === 'linux' ? `Stockily_${version}_amd64.AppImage` : `Stockily_${version}_x64-setup.exe`;

export interface ReleaseEntry {
  platform: Platform;
  version: string;
  /** File name inside RELEASES_DIR. Only ever read from the manifest, never from a request. */
  file: string;
  sha256: string;
  size: number;
  /** Contents of the `.sig` file produced by `tauri build` (minisign), checked by the app before installing. */
  signature: string;
  notes: string;
  publishedAt: string;
  /**
   * Light update: a small signed zip with only what changes between most releases (api, web,
   * migrations, our own packages). Usable by an installed app only if its "base" (Node, Postgres,
   * dependencies, Prisma engine, runner) is the one this release was built on: `baseId`.
   */
  baseId?: string;
  light?: { file: string; sha256: string; size: number; signature: string };
}

/** The one file name allowed for a release's light update. */
export const lightFileNameFor = (platform: Platform, version: string) => `Stockily_${version}_light-${platform}.zip`;

export type LightPlan =
  | { mode: 'none' }
  | { mode: 'full' }
  | { mode: 'light'; version: string; notes: string; url: string; sha256: string; size: number; signature: string };

const SEMVER = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const SHA256 = /^[0-9a-f]{64}$/;

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  return 0;
}

// Installers live on the server's disk (RELEASES_DIR, a read-only volume) and
// are described by manifest.json, written by apps/desktop/scripts/publish-release.mjs.
// Security model for downloads:
//  - the request only names a platform and a version; the file name comes from
//    the manifest and must match a strict pattern, so there is no path to inject;
//  - the file must be a regular file (no symlink), inside RELEASES_DIR, with the
//    recorded size, and its SHA-256 must equal the manifest's (checked once per
//    file change), so a swapped or corrupted file is never served;
//  - the app additionally verifies the minisign signature of what it downloads.
@Injectable()
export class ReleasesService {
  private readonly logger = new Logger(ReleasesService.name);
  private cache: { at: number; releases: ReleaseEntry[] } | null = null;
  private readonly verified = new Map<string, string>(); // file -> "mtime:size" last hashed OK

  get dir(): string {
    return resolve(process.env.RELEASES_DIR ?? '/data/releases');
  }

  private async load(): Promise<ReleaseEntry[]> {
    if (this.cache && Date.now() - this.cache.at < 5_000) return this.cache.releases;
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(join(this.dir, 'manifest.json'), 'utf8'));
    } catch {
      this.cache = { at: Date.now(), releases: [] };
      return [];
    }
    const list = Array.isArray((raw as { releases?: unknown })?.releases) ? ((raw as { releases: unknown[] }).releases as Partial<ReleaseEntry>[]) : [];
    const releases = list.filter((r): r is ReleaseEntry => {
      const ok =
        !!r &&
        PLATFORMS.includes(r.platform as Platform) &&
        typeof r.version === 'string' && SEMVER.test(r.version) &&
        typeof r.file === 'string' && r.file === fileNameFor(r.platform as Platform, r.version) &&
        typeof r.sha256 === 'string' && SHA256.test(r.sha256) &&
        typeof r.size === 'number' && r.size > 0 &&
        typeof r.signature === 'string' && r.signature.length > 0;
      if (!ok) this.logger.warn(`Ignoring invalid release entry: ${JSON.stringify(r)?.slice(0, 120)}`);
      return ok;
    });
    // A malformed light part never invalidates the release itself: it just is not offered.
    for (const r of releases) {
      const l = r.light;
      const good =
        !!l &&
        typeof r.baseId === 'string' && SHA256.test(r.baseId) &&
        l.file === lightFileNameFor(r.platform, r.version) &&
        typeof l.sha256 === 'string' && SHA256.test(l.sha256) &&
        typeof l.size === 'number' && l.size > 0 &&
        typeof l.signature === 'string' && l.signature.length > 0;
      if (!good) {
        delete r.light;
        delete r.baseId;
      }
    }
    this.cache = { at: Date.now(), releases };
    return releases;
  }

  async latest(platform: Platform): Promise<ReleaseEntry | null> {
    const all = (await this.load()).filter((r) => r.platform === platform);
    return all.sort((a, b) => compareVersions(b.version, a.version))[0] ?? null;
  }

  async find(platform: Platform, version: string): Promise<ReleaseEntry | null> {
    if (version === 'latest') return this.latest(platform);
    if (!SEMVER.test(version)) return null;
    return (await this.load()).find((r) => r.platform === platform && r.version === version) ?? null;
  }

  /** Public, harmless metadata for the download page. */
  async overview() {
    return Promise.all(
      PLATFORMS.map(async (platform) => {
        const r = await this.latest(platform);
        return r
          ? { platform, available: true, version: r.version, size: r.size, sha256: r.sha256, publishedAt: r.publishedAt, notes: r.notes, fileName: r.file }
          : { platform, available: false };
      }),
    );
  }

  /**
   * Returns the (already validated) file name to serve, or null when the file
   * is missing, is not a plain file of the recorded size, or fails its hash.
   */
  async servableFile(entry: ReleaseEntry, kind: 'full' | 'light' = 'full'): Promise<string | null> {
    const target = kind === 'light' ? entry.light : entry;
    if (!target) return null;
    const path = resolve(this.dir, target.file);
    if (!path.startsWith(this.dir + '/') && !path.startsWith(this.dir + '\\')) return null;
    let st;
    try {
      st = await lstat(path); // lstat: a symlink is refused, not followed
    } catch {
      return null;
    }
    if (!st.isFile() || st.size !== target.size) {
      this.logger.error(`Release file ${target.file} is not a regular file of the recorded size.`);
      return null;
    }
    const stamp = `${st.mtimeMs}:${st.size}`;
    if (this.verified.get(target.file) !== stamp) {
      const hash = createHash('sha256');
      await new Promise<void>((ok, fail) => createReadStream(path).on('data', (c) => hash.update(c)).on('end', () => ok()).on('error', fail));
      if (hash.digest('hex') !== target.sha256) {
        this.logger.error(`Release file ${target.file} does not match its recorded SHA-256: refusing to serve it.`);
        return null;
      }
      this.verified.set(target.file, stamp);
    }
    return target.file;
  }

  /** Tauri updater response, or null (204) when `current` is already the latest. */
  async updateFor(platform: Platform, current: string, publicUrl: string) {
    const r = await this.latest(platform);
    if (!r || compareVersions(r.version, current) <= 0) return null;
    if (!(await this.servableFile(r))) return null; // never announce what we cannot serve
    return {
      version: r.version,
      notes: r.notes,
      pub_date: r.publishedAt,
      url: `${publicUrl}/api/downloads/${platform}/${r.version}`,
      signature: r.signature,
    };
  }

  /**
   * What an installed app should do, given its base and the version it effectively runs
   * (installed version, or a light update applied on top of it):
   *  none  - already on the newest version
   *  light - a small signed zip is enough (same base)
   *  full  - the newest version needs the complete installer (base changed or no light part)
   */
  async lightPlan(platform: Platform, baseId: string, effective: string, publicUrl: string): Promise<LightPlan> {
    const latest = await this.latest(platform);
    if (!latest || compareVersions(latest.version, effective) <= 0) return { mode: 'none' };
    if (latest.light && latest.baseId === baseId && (await this.servableFile(latest, 'light'))) {
      return {
        mode: 'light',
        version: latest.version,
        notes: latest.notes,
        url: `${publicUrl}/api/downloads/${platform}/${latest.version}/light`,
        sha256: latest.light.sha256,
        size: latest.light.size,
        signature: latest.light.signature,
      };
    }
    return { mode: 'full' };
  }
}
