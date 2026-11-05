import { BadRequestException, Body, Controller, ForbiddenException, Get, Ip, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CreateMemberDto, UpdateMemberDto } from '../modules/members/members.dto';
import { AdminAuthGuard, AuthenticatedAdmin, CurrentAdmin } from './admin-auth.guard';
import { AdminAuditService } from './admin-audit.service';
import { AdminService } from './admin.service';
import { AdminSqlService } from './admin-sql.service';
import { AdminUpdateUserDto, RunSqlDto, SetDeviceDto, SetModuleDto, SetPriceDto, SetSeatsDto } from './admin.dto';

const SQL_WRITE_PHRASE = 'JE CONFIRME';

// The platform-admin console API. Every route requires a platform-admin token.
@Controller('admin')
@UseGuards(AdminAuthGuard)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly audit: AdminAuditService,
    private readonly sql: AdminSqlService,
  ) {}

  @Get('dashboard')
  dashboard() {
    return this.admin.dashboard();
  }

  @Get('organizations')
  orgs(@Query('search') search?: string) {
    return this.admin.listOrganizations(search);
  }

  @Get('organizations/:id')
  orgDetail(@Param('id') id: string) {
    return this.admin.organizationDetail(id);
  }

  @Post('organizations/:id/modules/:key')
  async setModule(@CurrentAdmin() a: AuthenticatedAdmin, @Param('id') id: string, @Param('key') key: string, @Body() dto: SetModuleDto, @Ip() ip: string) {
    const result = await this.admin.setModule(id, key, dto.action, dto.force);
    await this.audit.log(a, `module.${dto.action}`, { orgId: id, module: key, force: !!dto.force }, ip);
    return result;
  }

  @Patch('organizations/:id/seats')
  async setSeats(@CurrentAdmin() a: AuthenticatedAdmin, @Param('id') id: string, @Body() dto: SetSeatsDto, @Ip() ip: string) {
    const result = await this.admin.setSeatsPerSite(id, dto.seatsPerSite);
    await this.audit.log(a, 'org.seats', { orgId: id, seatsPerSite: dto.seatsPerSite }, ip);
    return result;
  }

  @Get('grantable-modules')
  grantable() {
    return this.admin.grantableModules();
  }

  @Get('organizations/:id/users')
  users(@Param('id') id: string) {
    return this.admin.listUsers(id);
  }

  @Post('organizations/:id/users')
  async createUser(@CurrentAdmin() a: AuthenticatedAdmin, @Param('id') id: string, @Body() dto: CreateMemberDto, @Ip() ip: string) {
    const result = await this.admin.createUser(id, a.id, dto);
    await this.audit.log(a, 'user.create', { orgId: id, username: dto.username }, ip);
    return result;
  }

  @Patch('organizations/:id/users/:userId')
  async updateUser(@CurrentAdmin() a: AuthenticatedAdmin, @Param('id') id: string, @Param('userId') userId: string, @Body() dto: UpdateMemberDto, @Ip() ip: string) {
    const result = await this.admin.updateUser(id, a.id, userId, dto);
    await this.audit.log(a, 'user.update', { orgId: id, userId, changedPassword: !!dto.password, isActive: dto.isActive }, ip);
    return result;
  }

  @Patch('organizations/:id/users/:userId/account')
  async updateUserAccount(@CurrentAdmin() a: AuthenticatedAdmin, @Param('id') id: string, @Param('userId') userId: string, @Body() dto: AdminUpdateUserDto, @Ip() ip: string) {
    const result = await this.admin.updateUserAccount(id, userId, dto);
    await this.audit.log(a, 'user.update', { orgId: id, userId, displayName: dto.displayName, username: dto.username, email: dto.email, changedPassword: !!dto.password, isActive: dto.isActive }, ip);
    return result;
  }

  @Post('devices/:id/set')
  async setDevice(@CurrentAdmin() a: AuthenticatedAdmin, @Param('id') id: string, @Body() dto: SetDeviceDto, @Ip() ip: string) {
    const result = await this.admin.setDevice(id, dto.action);
    await this.audit.log(a, `device.${dto.action}`, { deviceId: id }, ip);
    return result;
  }

  @Get('pricing')
  pricing() {
    return this.admin.listPricing();
  }

  @Patch('pricing/:moduleKey')
  async setPrice(@CurrentAdmin() a: AuthenticatedAdmin, @Param('moduleKey') moduleKey: string, @Body() dto: SetPriceDto, @Ip() ip: string) {
    const result = await this.admin.setPrice(moduleKey, dto.monthlyPrice, dto.isActive ?? true);
    await this.audit.log(a, 'pricing.set', { moduleKey, monthlyPrice: dto.monthlyPrice }, ip);
    return result;
  }

  @Get('payments')
  payments() {
    return this.admin.listPayments();
  }

  @Get('logs')
  logs(@Query('limit') limit?: string) {
    return this.admin.logs(limit ? Math.min(1000, Math.max(1, Number(limit))) : 200);
  }

  @Get('schema')
  schema() {
    return this.admin.schema();
  }

  @Post('sql')
  async runSql(@CurrentAdmin() a: AuthenticatedAdmin, @Body() dto: RunSqlDto, @Ip() ip: string) {
    const write = !!dto.write;
    if (write) {
      if (dto.confirm !== SQL_WRITE_PHRASE) {
        throw new ForbiddenException({ statusCode: 403, error: 'confirmation_required', message: `Pour écrire, tapez exactement « ${SQL_WRITE_PHRASE} » dans la confirmation.` });
      }
      // Log the full statement BEFORE running it, so even a statement that
      // errors or hangs is on the record.
      await this.audit.log(a, 'sql.write', { sql: dto.sql }, ip);
    }
    try {
      return await this.sql.run(dto.sql, write);
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      // Surface the DB error message to the console, but as a clean 400.
      throw new BadRequestException(err instanceof Error ? err.message : 'Erreur SQL.');
    }
  }
}
