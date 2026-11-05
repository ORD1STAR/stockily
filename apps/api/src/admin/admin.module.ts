import { Module } from '@nestjs/common';
import { MembersService } from '../modules/members/members.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminPrismaService } from './admin-prisma.service';
import { AdminAuthService } from './admin-auth.service';
import { AdminAuthGuard } from './admin-auth.guard';
import { AdminAuditService } from './admin-audit.service';
import { AdminService, ADMIN_MEMBERS } from './admin.service';
import { AdminSqlService } from './admin-sql.service';
import { AdminAuthController } from './admin-auth.controller';
import { AdminController } from './admin.controller';

// Platform-admin console. Registered ONLY when NOT in local/desktop mode
// (see AppModule) — a device never exposes any of this. Everything here
// goes through AdminPrismaService (superuser, cross-tenant), never the
// request-scoped RLS PrismaService.
@Module({
  controllers: [AdminAuthController, AdminController],
  providers: [
    AdminPrismaService,
    AdminAuthService,
    AdminAuthGuard,
    AdminAuditService,
    AdminService,
    AdminSqlService,
    // A MembersService bound to the superuser client so sub-user management
    // works cross-tenant. MembersService's constructor type wants the RLS
    // PrismaService; the admin client is structurally the same PrismaClient,
    // and setTenantOnTransaction is harmless under a BYPASSRLS role.
    { provide: ADMIN_MEMBERS, useFactory: (p: AdminPrismaService) => new MembersService(p as unknown as PrismaService), inject: [AdminPrismaService] },
  ],
})
export class AdminModule {}
