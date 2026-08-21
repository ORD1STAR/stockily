import { Body, Controller, Get, Param, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { CurrentUser, AuthenticatedUser } from '../tenancy/decorators/current-user.decorator';
import { RequiresModule } from '../tenancy/decorators/requires-module.decorator';
import { RequiresPermission } from '../tenancy/decorators/requires-permission.decorator';
import { JwtAuthGuard } from '../tenancy/guards/jwt-auth.guard';
import { ModuleEntitlementGuard } from '../tenancy/guards/module-entitlement.guard';
import { PermissionGuard } from '../tenancy/guards/permission.guard';
import { SiteScopeGuard } from '../tenancy/guards/site-scope.guard';
import { Audit } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { QualityService } from './quality.service';
import { CreateBatchDto } from './dto/create-batch.dto';
import { RecordQualityCheckDto } from './dto/record-quality-check.dto';
import { ResolveNonConformityDto } from './dto/resolve-nonconformity.dto';

// Every route here runs behind the full guard chain (docs/Action Plan.md §4).
// Quality requires Stock (module dependency, seeded in
// packages/infra-db/prisma/seed.ts) — enforced by ModuleEntitlementGuard
// checking THIS module's own entitlement; an org without Stock active never
// gets a Quality entitlement to begin with (activation-time concern, not
// re-checked per-request here).
@Controller('quality')
@UseGuards(JwtAuthGuard, ModuleEntitlementGuard, PermissionGuard, SiteScopeGuard)
@RequiresModule('quality')
export class QualityController {
  constructor(private readonly quality: QualityService) {}

  @Post('batches')
  @RequiresPermission('quality', 'quality.batch.write')
  @UseInterceptors(AuditInterceptor)
  @Audit('batch', 'quality.batch.created')
  createBatch(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateBatchDto) {
    return this.quality.createBatch(user.orgId, dto);
  }

  // ?productId=<id> both filters AND enriches each batch with its most
  // recent quality-check result (the Stock module's SKU-detail view uses
  // this shape directly — see docs/MILESTONE_3.md).
  @Get('batches')
  @RequiresPermission('quality', 'quality.batch.read')
  listBatches(@CurrentUser() user: AuthenticatedUser, @Query('productId') productId?: string) {
    if (productId) return this.quality.listBatchesWithLatestCheck(user.orgId, productId);
    return this.quality.listBatches(user.orgId);
  }

  @Get('batches/:id')
  @RequiresPermission('quality', 'quality.batch.read')
  getBatch(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.quality.getBatch(user.orgId, id);
  }

  // Covers both the batch-based and product-direct paths — see
  // RecordQualityCheckDto's doc comment. A failed result auto-opens the
  // linked non-conformity and performs the resulting quarantine(s) as part
  // of this same call (quality.service.ts's recordQualityCheck).
  @Post('checks')
  @RequiresPermission('quality', 'quality.check.create')
  @UseInterceptors(AuditInterceptor)
  @Audit('quality_check', 'quality.check.created')
  recordCheck(@CurrentUser() user: AuthenticatedUser, @Body() dto: RecordQualityCheckDto) {
    return this.quality.recordQualityCheck(user.orgId, user.userId, dto);
  }

  // No POST /quality/non-conformities — there is no separate "create"
  // action (packages/infra-db/prisma/seed.ts seeds only .read/.resolve for
  // this resource): a non-conformity is only ever opened as a side effect of
  // a failed quality check, above.
  @Get('non-conformities')
  @RequiresPermission('quality', 'quality.nonconformity.read')
  listNonConformities(@CurrentUser() user: AuthenticatedUser, @Query('status') status?: 'open' | 'resolved') {
    return this.quality.listNonConformities(user.orgId, status);
  }

  @Post('non-conformities/:id/resolve')
  @RequiresPermission('quality', 'quality.nonconformity.resolve')
  @UseInterceptors(AuditInterceptor)
  @Audit('non_conformity', 'quality.nonconformity.resolved')
  resolveNonConformity(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: ResolveNonConformityDto) {
    return this.quality.resolveNonConformity(user.orgId, id, dto.resolutionNotes);
  }

  // Computed, not a stored notification channel (no Notifications module
  // yet, §3) — GET-triggers a fresh sweep every time so demo/dev
  // environments without ExpirySweepScheduler's interval running still see
  // correct data.
  @Get('expiry-alerts')
  @RequiresPermission('quality', 'quality.batch.read')
  listExpiryAlerts(@CurrentUser() user: AuthenticatedUser) {
    return this.quality.listExpiryAlerts(user.orgId);
  }
}
