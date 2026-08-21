import { Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';

// JwtService comes from the globally-registered JwtConfigModule (same
// pattern as AuthModule) — not imported here directly.
@Module({
  providers: [RealtimeGateway],
})
export class RealtimeModule {}
