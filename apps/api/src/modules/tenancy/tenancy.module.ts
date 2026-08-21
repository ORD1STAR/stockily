import { Module } from '@nestjs/common';
import { MeController } from './me.controller';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { ModuleEntitlementGuard } from './guards/module-entitlement.guard';
import { PermissionGuard } from './guards/permission.guard';
import { SiteScopeGuard } from './guards/site-scope.guard';
import { EntitlementCacheService } from './services/entitlement-cache.service';

// The guard chain from docs/Action Plan.md §4 — JwtAuthGuard ->
// ModuleEntitlementGuard -> PermissionGuard -> SiteScopeGuard, in that
// order — plus the decorators/exceptions they use. Other feature modules
// (Stock, Quality, Invoicing... in later milestones) import TenancyModule
// to reuse these guards via `@UseGuards(...)` rather than each
// reimplementing entitlement/permission checks.
//
// Note: this NestJS module (a compile-time DI concern, loaded identically
// for every tenant) is distinct from a "tenancy" *product* module — there
// isn't one; tenancy is cross-cutting infrastructure every product module
// relies on, not something a customer activates or pays for (§1).
@Module({
  controllers: [MeController],
  providers: [JwtAuthGuard, ModuleEntitlementGuard, PermissionGuard, SiteScopeGuard, EntitlementCacheService],
  exports: [JwtAuthGuard, ModuleEntitlementGuard, PermissionGuard, SiteScopeGuard],
})
export class TenancyModule {}
