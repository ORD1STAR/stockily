import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

const WS_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/api\/?$/, '') ?? 'http://localhost:3000';

export interface StockRealtimeEvent {
  kind: string;
  orgId: string;
  siteId: string;
  [key: string]: unknown;
}

/**
 * Connects once per mounted page, authenticated with the same access token
 * as HTTP calls (apps/api's RealtimeGateway verifies it the same way
 * JwtAuthGuard does). Org-room membership is automatic server-side on
 * connect; `siteId` (if given) additionally joins that site's room — a
 * page showing "Tous les sites" can pass `null` and rely on the org room
 * alone. Proves the Milestone 2 real-time seam works from the browser, not
 * just from the server-side smoke test.
 */
export function useStockRealtime(accessToken: string | null, siteId: string | null, onEvent: (event: StockRealtimeEvent) => void): void {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!accessToken) return;
    const socket: Socket = io(WS_BASE, { auth: { token: accessToken } });

    socket.on('stock-event', (event: StockRealtimeEvent) => onEventRef.current(event));
    if (siteId && siteId !== 'all') socket.emit('join-site', siteId);

    return () => {
      socket.close();
    };
    // Reconnects when the token changes (new session) or the site being
    // viewed changes (join-site needs to run again for the new room).
  }, [accessToken, siteId]);
}
