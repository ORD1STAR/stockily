import { Body, Controller, Get, Param, Patch, Post, Query, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser, AuthenticatedUser } from '../tenancy/decorators/current-user.decorator';
import { RequiresModule } from '../tenancy/decorators/requires-module.decorator';
import { RequiresPermission } from '../tenancy/decorators/requires-permission.decorator';
import { JwtAuthGuard } from '../tenancy/guards/jwt-auth.guard';
import { ModuleEntitlementGuard } from '../tenancy/guards/module-entitlement.guard';
import { PermissionGuard } from '../tenancy/guards/permission.guard';
import { SiteScopeGuard } from '../tenancy/guards/site-scope.guard';
import { Audit } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { CountersService } from './counters.service';
import { CashMovementDto, CloseSessionDto, CounterSaleDto, CreateCounterDto, OpenSessionDto, UpdateCounterDto } from './counters.dto';

// Comptoirs — part of the Scan module (ventes au scan). Selling reuses the
// sales permission (a comptoir sale is a bon de livraison).
@Controller('counters')
@UseGuards(JwtAuthGuard, ModuleEntitlementGuard, PermissionGuard, SiteScopeGuard)
@RequiresModule('scan')
export class CountersController {
  constructor(private readonly counters: CountersService) {}

  private pdf(res: Response, pdf: Buffer, name: string) {
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${name}.pdf"` });
    res.send(pdf);
  }

  @Get()
  @RequiresPermission('scan', 'scan.counter.read')
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.counters.list(user.orgId, user.userId);
  }

  @Post()
  @RequiresPermission('scan', 'scan.counter.create')
  @UseInterceptors(AuditInterceptor)
  @Audit('counter', 'counter.created')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCounterDto) {
    return this.counters.create(user.orgId, dto);
  }

  @Patch(':id')
  @RequiresPermission('scan', 'scan.counter.create')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateCounterDto) {
    return this.counters.update(user.orgId, id, dto);
  }

  @Post(':id/open')
  @RequiresPermission('scan', 'scan.counter.session')
  @UseInterceptors(AuditInterceptor)
  @Audit('counter_session', 'counter.session.opened')
  open(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: OpenSessionDto) {
    return this.counters.open(user.orgId, user.userId, id, dto);
  }

  @Get('sessions/list')
  @RequiresPermission('scan', 'scan.counter.read')
  sessions(@CurrentUser() user: AuthenticatedUser, @Query('counterId') counterId?: string) {
    return this.counters.listSessions(user.orgId, user.userId, counterId);
  }

  @Get('sessions/:id')
  @RequiresPermission('scan', 'scan.counter.read')
  session(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.counters.summary(user.orgId, id);
  }

  @Post('sessions/:id/movements')
  @RequiresPermission('scan', 'scan.counter.cash')
  @UseInterceptors(AuditInterceptor)
  @Audit('counter_session', 'counter.cash.movement')
  movement(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: CashMovementDto) {
    return this.counters.addMovement(user.orgId, user.userId, id, dto);
  }

  @Post('sessions/:id/close')
  @RequiresPermission('scan', 'scan.counter.session')
  @UseInterceptors(AuditInterceptor)
  @Audit('counter_session', 'counter.session.closed')
  close(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: CloseSessionDto) {
    return this.counters.close(user.orgId, user.userId, id, dto);
  }

  @Post('sessions/:id/sales')
  @RequiresPermission('scan', 'scan.counter.sell')
  @UseInterceptors(AuditInterceptor)
  @Audit('trade_document', 'counter.sale.created')
  sale(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: CounterSaleDto) {
    return this.counters.sale(user.orgId, user.userId, id, dto);
  }

  @Get('sessions/:id/z')
  @RequiresPermission('scan', 'scan.counter.ticket')
  async z(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Res() res: Response) {
    this.pdf(res, await this.counters.zReportPdf(user.orgId, id), `ticket-z-${id}`);
  }

  @Get('tickets/:documentId')
  @RequiresPermission('scan', 'scan.counter.ticket')
  async ticket(@CurrentUser() user: AuthenticatedUser, @Param('documentId') documentId: string, @Res() res: Response) {
    this.pdf(res, await this.counters.ticketPdf(user.orgId, documentId), `ticket-${documentId}`);
  }
}
