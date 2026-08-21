import { SetMetadata } from '@nestjs/common';

export const AUDIT_KEY = 'auditMeta';

export interface AuditMeta {
  entityType: string;
  action: string;
}

// Marks a handler as mutating and worth an audit_log row (docs/Action
// Plan.md §4 — "traçabilité native", populated via an interceptor across
// Stock/Quality/Invoicing from day one). Read by AuditInterceptor.
export const Audit = (entityType: string, action: string) => SetMetadata(AUDIT_KEY, { entityType, action } satisfies AuditMeta);
