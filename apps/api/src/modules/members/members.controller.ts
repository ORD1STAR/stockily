import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { CurrentUser, AuthenticatedUser } from '../tenancy/decorators/current-user.decorator';
import { RequiresPermission } from '../tenancy/decorators/requires-permission.decorator';
import { JwtAuthGuard } from '../tenancy/guards/jwt-auth.guard';
import { PermissionGuard } from '../tenancy/guards/permission.guard';
import { Audit } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { CreateMemberDto, UpdateMemberDto } from './members.dto';
import { MembersService } from './members.service';

// Org-side sub-user (member) management. Gated by the 'members.user.manage'
// permission (Super Admin / Gestionnaire only) — not entitlement-gated, so
// no @RequiresModule.
@Controller('members')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @RequiresPermission('members', 'members.user.manage')
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.members.list(user.orgId);
  }

  @Get('grantable-modules')
  @RequiresPermission('members', 'members.user.manage')
  grantable() {
    return this.members.grantableModules();
  }

  @Post()
  @RequiresPermission('members', 'members.user.manage')
  @UseInterceptors(AuditInterceptor)
  @Audit('user', 'members.user.created')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateMemberDto) {
    return this.members.create(user.orgId, user.userId, dto);
  }

  @Patch(':id')
  @RequiresPermission('members', 'members.user.manage')
  @UseInterceptors(AuditInterceptor)
  @Audit('user', 'members.user.updated')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateMemberDto) {
    return this.members.update(user.orgId, user.userId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequiresPermission('members', 'members.user.manage')
  @UseInterceptors(AuditInterceptor)
  @Audit('user', 'members.user.deactivated')
  deactivate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.members.deactivate(user.orgId, user.userId, id);
  }
}
