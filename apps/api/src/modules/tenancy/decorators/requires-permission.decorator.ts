import { SetMetadata } from '@nestjs/common';

export const REQUIRES_PERMISSION_KEY = 'requiresPermission';

export interface RequiredPermission {
  moduleKey: string;
  action: string;
}

// Checked by PermissionGuard: resolves user -> user_roles (site-scoped or
// org-wide) -> role_permissions(moduleKey, action). See docs/Action Plan.md
// §2/§4 for the resolution rule.
export const RequiresPermission = (moduleKey: string, action: string) =>
  SetMetadata(REQUIRES_PERMISSION_KEY, { moduleKey, action } satisfies RequiredPermission);
