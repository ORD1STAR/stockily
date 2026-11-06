import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { PLATFORMS, Platform, ReleasesService } from './releases.service';

const SEMVER = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const SHA256 = /^[0-9a-f]{64}$/;

// Public: the marketing site's "Télécharger l'application" and the desktop
// app's auto-update. Nothing here accepts a file name or a path.
@Controller()
export class ReleasesController {
  constructor(private readonly releases: ReleasesService) {}

  @Get('downloads')
  overview() {
    return this.releases.overview();
  }

  @Get('downloads/:platform/:version')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async download(@Param('platform') platform: string, @Param('version') version: string, @Res() res: Response) {
    if (!PLATFORMS.includes(platform as Platform)) throw new NotFoundException();
    const entry = await this.releases.find(platform as Platform, version);
    if (!entry) throw new NotFoundException('Version introuvable.');
    const file = await this.releases.servableFile(entry);
    if (!file) throw new NotFoundException('Ce fichier n’est pas disponible pour le moment.');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Checksum-Sha256', entry.sha256);
    // "latest" moves; a numbered version never changes.
    res.setHeader('Cache-Control', version === 'latest' ? 'no-cache' : 'public, max-age=86400, immutable');
    // sendFile: ranges (resumable downloads), and `root` + dotfiles:'deny' as a second wall against traversal.
    res.sendFile(file, { root: this.releases.dir, dotfiles: 'deny', acceptRanges: true, cacheControl: false }, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  }

  // The small signed zip of a release (api, web, migrations): same security model as the installer.
  @Get('downloads/:platform/:version/light')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async downloadLight(@Param('platform') platform: string, @Param('version') version: string, @Res() res: Response) {
    if (!PLATFORMS.includes(platform as Platform) || !SEMVER.test(version)) throw new NotFoundException();
    const entry = await this.releases.find(platform as Platform, version);
    const file = entry && (await this.releases.servableFile(entry, 'light'));
    if (!entry || !file) throw new NotFoundException('Ce fichier n’est pas disponible pour le moment.');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Checksum-Sha256', entry.light?.sha256 ?? '');
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.sendFile(file, { root: this.releases.dir, dotfiles: 'deny', acceptRanges: true, cacheControl: false }, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  }

  // Light-update check: /updates/light/{target}/{arch}/{baseId}/{effective_version}
  @Get('updates/light/:target/:arch/:baseId/:current')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async lightUpdate(@Param('target') target: string, @Param('arch') arch: string, @Param('baseId') baseId: string, @Param('current') current: string) {
    const base = (process.env.PUBLIC_APP_URL ?? 'https://stockily.ordi-tech.com').replace(/\/$/, '');
    const version = current.split('+')[0];
    if (!PLATFORMS.includes(target as Platform) || arch !== 'x86_64' || !SHA256.test(baseId) || !SEMVER.test(version)) return { mode: 'none' };
    return this.releases.lightPlan(target as Platform, baseId, version, base);
  }

  // Tauri updater endpoint: /updates/{{target}}/{{arch}}/{{current_version}}
  @Get('updates/:target/:arch/:current')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async update(@Param('target') target: string, @Param('arch') arch: string, @Param('current') current: string, @Res() res: Response) {
    const base = (process.env.PUBLIC_APP_URL ?? 'https://stockily.ordi-tech.com').replace(/\/$/, '');
    const version = current.split('+')[0];
    if (!PLATFORMS.includes(target as Platform) || arch !== 'x86_64' || !SEMVER.test(version)) return res.status(204).end();
    const update = await this.releases.updateFor(target as Platform, version, base);
    if (!update) return res.status(204).end();
    return res.json(update);
  }
}
