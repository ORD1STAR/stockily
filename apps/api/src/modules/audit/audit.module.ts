import { Module } from '@nestjs/common';

// Placeholder — see docs/Action Plan.md §1/§7.
// Real controllers/services/providers land here per the Phase 1 milestone
// sequence (§7): platform bootstrap -> Stock+Sites -> Quality -> Invoicing ->
// Scan. This module's *product* entitlement (module registry row / feature
// gate, §1) is a separate, runtime, per-tenant concern from this NestJS
// module's compile-time DI boundary — do not conflate the two.
@Module({})
export class AuditModule {}
