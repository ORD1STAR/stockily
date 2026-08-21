import { Module } from '@nestjs/common';
import { AuditInterceptor } from './audit.interceptor';

// Provides AuditInterceptor for other modules to apply via
// `@UseInterceptors(AuditInterceptor)` alongside `@Audit(entityType,
// action)` on the specific handlers that mutate state (docs/Action Plan.md
// §4). Not applied globally — most GET routes have nothing to audit.
@Module({
  providers: [AuditInterceptor],
  exports: [AuditInterceptor],
})
export class AuditModule {}
