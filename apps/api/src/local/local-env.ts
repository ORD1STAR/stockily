// Local mode = this API running on a shop's desktop machine (inside the
// Stockily desktop app), against the device's own embedded Postgres, with
// the real server reachable only some of the time. Set by the desktop
// shell when it spawns the API; never set on the server.
export const isLocalMode = () => process.env.STOCKILY_LOCAL_MODE === '1';

export function localEnv() {
  return {
    /** Origin of the real Stockily server, e.g. https://stockily.ordi-tech.com (API under /api). */
    remoteOrigin: (process.env.STOCKILY_REMOTE_ORIGIN ?? 'https://stockily.ordi-tech.com').replace(/\/+$/, ''),
    licenseToken: process.env.STOCKILY_LICENSE_TOKEN ?? '',
    /** Shared secret the desktop shell uses for /api/local/control/* (license updates after renewal). */
    controlSecret: process.env.STOCKILY_CONTROL_SECRET ?? '',
    /** Built web app to serve on the same origin as the API. */
    webDir: process.env.STOCKILY_WEB_DIR ?? '',
    /** Superuser connection — the snapshot loader needs to bypass RLS and FK triggers. */
    adminDatabaseUrl: process.env.DATABASE_URL ?? '',
    pullIntervalMs: Number(process.env.STOCKILY_PULL_INTERVAL_MS ?? 5 * 60_000),
    tickIntervalMs: Number(process.env.STOCKILY_SYNC_TICK_MS ?? 20_000),
  };
}
