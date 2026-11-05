import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/** Imperative permission check for routes whose required action depends on the payload (e.g. encaisser vs décaisser). */
export async function assertPermission(prisma: PrismaService, userId: string, moduleKey: string, action: string): Promise<void> {
  const module = await prisma.module.findUnique({ where: { key: moduleKey } });
  const roles = await prisma.userRole.findMany({ where: { userId }, select: { roleId: true } });
  const hit =
    module && roles.length > 0
      ? await prisma.rolePermission.findFirst({ where: { roleId: { in: roles.map((r) => r.roleId) }, moduleId: module.id, action } })
      : null;
  if (!hit) {
    throw new ForbiddenException({ statusCode: 403, error: 'permission_denied', action, message: `Permission manquante : ${action}` });
  }
}
