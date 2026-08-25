import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

interface StockRealtimeEvent {
  kind: string;
  orgId: string;
  siteId: string;
  [key: string]: unknown;
}

// Quality's events (docs/MILESTONE_3.md) are batch/product-level, not
// site-scoped — a batch can span sites, so there's no single site room to
// target. Broadcast org-wide only.
interface QualityRealtimeEvent {
  kind: string;
  orgId: string;
  [key: string]: unknown;
}

/**
 * Broadcasts @org/domain-stock's domain events to connected clients
 * (docs/Action Plan.md §4/§5) — org-wide and per-site rooms, single-instance
 * only (no Redis adapter, §8 risk #4). Auth is a JWT passed at connection
 * time (`socket.handshake.auth.token`), verified with the same JwtService
 * that signs/verifies HTTP access tokens — a client that can't produce a
 * valid one is disconnected immediately, no anonymous connections accepted.
 */
@WebSocketGateway({ cors: { origin: '*' } })
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer() private server!: Server;
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(private readonly jwtService: JwtService) {}

  handleConnection(client: Socket): void {
    const token = client.handshake.auth?.['token'] ?? client.handshake.query?.['token'];
    if (!token || typeof token !== 'string') {
      client.disconnect(true);
      return;
    }
    try {
      const payload = this.jwtService.verify<{ sub: string; orgId: string }>(token);
      client.data.orgId = payload.orgId;
      client.join(`org:${payload.orgId}`);
    } catch {
      client.disconnect(true);
    }
  }

  // A client opts into a specific site's room once it knows which site the
  // user is viewing (e.g. the Stock page's site selector) — org-wide
  // membership above is automatic, site membership is client-driven since
  // only the client knows what it's currently looking at.
  @SubscribeMessage('join-site')
  handleJoinSite(@ConnectedSocket() client: Socket, @MessageBody() siteId: string): void {
    if (!client.data.orgId) return;
    client.join(`org:${client.data.orgId}:site:${siteId}`);
  }

  @OnEvent('StockMovementCreated')
  onStockMovementCreated(event: StockRealtimeEvent): void {
    this.broadcast(event);
  }

  @OnEvent('StockQuarantined')
  onStockQuarantined(event: StockRealtimeEvent): void {
    this.broadcast(event);
  }

  @OnEvent('StockLevelLow')
  onStockLevelLow(event: StockRealtimeEvent): void {
    this.broadcast(event);
  }

  private broadcast(event: StockRealtimeEvent): void {
    if (!this.server) return; // not yet initialized (e.g. under test)
    this.server.to(`org:${event.orgId}`).emit('stock-event', event);
    this.server.to(`org:${event.orgId}:site:${event.siteId}`).emit('stock-event', event);
    this.logger.debug(`Broadcast ${event.kind} to org:${event.orgId}`);
  }

  @OnEvent('NonConformityOpened')
  onNonConformityOpened(event: QualityRealtimeEvent): void {
    this.broadcastQuality(event);
  }

  @OnEvent('BatchNearExpiry')
  onBatchNearExpiry(event: QualityRealtimeEvent): void {
    this.broadcastQuality(event);
  }

  @OnEvent('BatchExpired')
  onBatchExpired(event: QualityRealtimeEvent): void {
    this.broadcastQuality(event);
  }

  private broadcastQuality(event: QualityRealtimeEvent): void {
    if (!this.server) return;
    this.server.to(`org:${event.orgId}`).emit('quality-event', event);
    this.logger.debug(`Broadcast ${event.kind} to org:${event.orgId}`);
  }
}
