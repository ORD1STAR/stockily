import { Injectable, NestMiddleware } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { NextFunction, Request, Response } from 'express';
import { AccessTokenPayload } from '../modules/tenancy/guards/jwt-auth.guard';
import { localEnv } from './local-env';
import { LocalStateService } from './local-state.service';
import { LocalSyncService } from './local-sync.service';

// Server-side features with no local copy: inventory counts (product
// decision), and the org's device seats / rejected syncs (that data only
// exists on the server).
// Public server endpoints: forwarded as they are, with no session (the catalog is shown before anyone is asked to pay).
const PUBLIC_PATHS = ['/api/billing/catalog'];

const ONLINE_ONLY = [
  { prefix: '/api/inventory/counts', label: 'L’inventaire nécessite une connexion internet.' },
  { prefix: '/api/licensing/devices', label: 'La gestion des appareils nécessite une connexion internet.' },
  { prefix: '/api/sync/replays', label: 'Cette page nécessite une connexion internet.' },
  // Server-only features (the Espace client: purchases, invoices, profile, suggestions) are forwarded to the server.
  { prefix: '/api/billing', label: 'Cette page nécessite une connexion internet.' },
  { prefix: '/api/account', label: 'Cette page nécessite une connexion internet.' },
  { prefix: '/api/suggestions', label: 'Cette page nécessite une connexion internet.' },
];

/**
 * Local mode only.
 *  - Inventaire (inventory counts) is online-only by product decision: the
 *    device forwards those requests to the server as the same user, and
 *    answers 503 with a clear message while offline. A validated count moves
 *    stock on the server, so a fresh snapshot is pulled right after.
 *  - Creating a new organization from a device makes no sense: signup is refused.
 */
@Injectable()
export class OnlineOnlyMiddleware implements NestMiddleware {
  constructor(
    private readonly state: LocalStateService,
    private readonly sync: LocalSyncService,
    private readonly jwt: JwtService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const path = req.originalUrl;
    if (path.startsWith('/api/auth/signup')) {
      return res.status(403).json({ statusCode: 403, error: 'not_available_offline', message: 'La création de compte se fait sur stockily.ordi-tech.com.' });
    }
    const rule = ONLINE_ONLY.find((r) => path.startsWith(r.prefix));
    if (!rule) return next();

    if (!this.state.online) {
      return res.status(503).json({
        statusCode: 503,
        error: 'online_only',
        message: `${rule.label} Disponible dès que cet ordinateur sera reconnecté.`,
      });
    }
    const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}?`));
    let userId = '';
    if (!isPublic) {
      try {
        userId = this.jwt.verify<AccessTokenPayload>(String(req.headers.authorization ?? '').replace(/^Bearer /, '')).sub;
      } catch {
        return res.status(401).json({ statusCode: 401, message: 'Jeton d’accès invalide ou expiré.' });
      }
    }

    try {
      const send = async (fresh: boolean) =>
        fetch(`${localEnv().remoteOrigin}${path}`, {
          method: req.method,
          headers: { ...(isPublic ? {} : { Authorization: `Bearer ${await this.sync.remoteTokenFor(userId, fresh)}` }), 'Content-Type': 'application/json' },
          body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body ?? {}),
          signal: AbortSignal.timeout(60_000),
        });
      let r = await send(false);
      if (r.status === 401) r = await send(true);
      res.status(r.status);
      const type = r.headers.get('content-type');
      if (type) res.setHeader('Content-Type', type);
      const disposition = r.headers.get('content-disposition');
      if (disposition) res.setHeader('Content-Disposition', disposition);
      res.send(Buffer.from(await r.arrayBuffer()));
      if (r.ok && req.method !== 'GET') this.sync.requestPull();
    } catch {
      this.state.online = false;
      res.status(503).json({ statusCode: 503, error: 'online_only', message: 'Connexion au serveur perdue, l’inventaire sera disponible dès le retour d’internet.' });
    }
  }
}
