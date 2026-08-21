import { Module } from '@nestjs/common';
import { MeController } from './me.controller';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { ModuleEntitlementGuard } from './guards/module-entitlement.guard';
import { PermissionGuard } from './guards/permission.guard';
import { SiteScopeGuard } from './guards/site-scope.guard';
import { EntitlementCacheService } from './services/entitlement-cache.service';
import { SiteAccessService } from './services/site-access.service';

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
  providers: [JwtAuthGuard, ModuleEntitlementGuard, PermissionGuard, SiteScopeGuard, EntitlementCacheService, SiteAccessService],
  // EntitlementCacheService must be exported too, not just provided — a
  // `@UseGuards(ModuleEntitlementGuard)` reference in a *different* module
  // (StockModule, SitesModule, ...) resolves that guard's own dependencies
  // against the consuming module's available providers, not just against
  // TenancyModule's internal ones. Milestone 1 never hit this because
  // ModuleEntitlementGuard was only ever used from within TenancyModule
  // itself (MeController); Milestone 2 is the first cross-module use.
  exports: [JwtAuthGuard, ModuleEntitlementGuard, PermissionGuard, SiteScopeGuard, EntitlementCacheService, SiteAccessService],
})
export class TenancyModule {}
