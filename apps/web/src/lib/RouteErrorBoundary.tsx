import { Component, ErrorInfo, ReactNode } from 'react';

// Without this, any error while a page loads or renders unmounts the whole
// tree and the user sees a blank page with no way out.
//
// The most common cause is a stale tab: after a deploy the page files change
// name (StockPage-abc.js → StockPage-def.js), so an old tab asking for the
// old name fails to load it. That is recovered automatically with ONE reload
// (guarded, so a real, persistent error can never loop). Any other error is
// shown with a button and its technical detail instead of a blank screen.

const RELOAD_FLAG = 'stockily.chunkReloadAt';

export function isChunkLoadError(err: unknown): boolean {
  const msg = String((err as { message?: string } | null)?.message ?? err ?? '');
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading chunk [\w-]+ failed|Unable to preload CSS|Expected a JavaScript.*module script/i.test(msg);
}

/** Reloads once per minute at most; returns whether a reload was triggered. */
export function reloadOnceForNewVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_FLAG) ?? 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
  } catch {
    /* storage unavailable: fall through to a single reload attempt */
  }
  window.location.reload();
  return true;
}

interface State {
  error: Error | null;
}

export class RouteErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[Stockily] page error:', error, info.componentStack);
    if (isChunkLoadError(error)) reloadOnceForNewVersion();
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const stale = isChunkLoadError(error);
    return (
      <div role="alert" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: 'var(--bg)' }}>
        <div style={{ maxWidth: 460, textAlign: 'center', display: 'grid', gap: 12 }}>
          <h2 style={{ fontSize: '1.25rem' }}>{stale ? 'Une nouvelle version est disponible' : 'Cette page n’a pas pu s’afficher'}</h2>
          <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
            {stale ? 'Rechargez la page pour continuer. Vos données ne sont pas perdues.' : 'Un incident est survenu. Rechargez la page, et si le problème revient, prévenez-nous avec le détail ci-dessous.'}
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn-primary" onClick={() => window.location.reload()}>
              Recharger la page
            </button>
            <a className="btn-secondary" href="/dashboard" style={{ textDecoration: 'none' }}>
              Retour à l’accueil
            </a>
          </div>
          {!stale && (
            <pre style={{ margin: 0, padding: 10, borderRadius: 8, background: 'var(--gray-100)', color: 'var(--text-muted)', fontSize: '0.72rem', textAlign: 'left', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {error.message}
            </pre>
          )}
        </div>
      </div>
    );
  }
}
