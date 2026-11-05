import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AdminPrismaService } from './admin-prisma.service';
import { AuthenticatedAdmin } from './admin-auth.guard';

// Records every platform-admin action. Write failures are logged, never fatal.
@Injectable()
export class AdminAuditService {
  private readonly logger = new Logger(AdminAuditService.name);

  constructor(private readonly prisma: AdminPrismaService) {}

  async log(admin: AuthenticatedAdmin, action: string, detail?: unknown, ip?: string) {
    try {
      await this.prisma.adminAuditLog.create({
        data: {
          adminId: admin.id,
          adminEmail: admin.email,
          action,
          detail: (detail ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          ip: ip ?? null,
        },
      });
    } catch (err) {
      this.logger.error(`Failed to write admin audit log for ${action}`, err instanceof Error ? err.stack : err);
    }
  }
}
