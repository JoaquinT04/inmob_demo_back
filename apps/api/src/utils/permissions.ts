import type {
  Permission,
  SystemGroup,
  SystemRole,
  TenantPermissionConfig,
  UserPermissionOverrides,
} from '@inmob/shared';
import { RolePermissions, resolveGroupPermissions, SystemGroup as SG } from '@inmob/shared';

export interface UserLike {
  roles: string[];
  groups?: SystemGroup[] | null;
  permissionOverrides?: UserPermissionOverrides | null;
}

/**
 * Resuelve el set completo de permisos efectivos para un usuario.
 *
 * Las 5 capas (en orden aditivo, excepto deny de capa 5):
 *   1. base:user     — mínimos para todo usuario autenticado (implícito)
 *   2. Role baseline — RolePermissions[role]
 *   3. Tenant overrides — el admin customiza por rol
 *   4. User groups   — grupos adicionales asignados al usuario
 *   5. User overrides — grant/deny individuales (deny tiene prioridad total)
 */
export function resolvePermissions(
  user: UserLike,
  tenantConfig?: TenantPermissionConfig | null,
): Set<Permission> {
  // Capa 1: base:user
  const effective = resolveGroupPermissions(SG.BASE_USER);

  // Capa 2: baseline del rol
  const primaryRole = user.roles[0] as SystemRole | undefined;
  if (primaryRole) {
    for (const p of (RolePermissions[primaryRole] ?? []) as Permission[]) {
      effective.add(p);
    }
  }

  // Capa 3: overrides del tenant por rol
  if (primaryRole) {
    const override = tenantConfig?.roleOverrides?.[primaryRole];
    if (override) {
      for (const p of override.grant ?? []) effective.add(p);
      for (const p of override.deny ?? []) effective.delete(p);
    }
  }

  // Capa 4: grupos asignados al usuario
  for (const groupId of user.groups ?? []) {
    for (const p of resolveGroupPermissions(groupId as SystemGroup)) {
      effective.add(p);
    }
  }

  // Capa 5: overrides individuales (deny tiene prioridad sobre todo lo anterior)
  const userOverride = user.permissionOverrides;
  if (userOverride) {
    for (const p of userOverride.grant ?? []) effective.add(p);
    for (const p of userOverride.deny ?? []) effective.delete(p);
  }

  return effective;
}

export function hasPermission(
  user: UserLike,
  permission: Permission,
  tenantConfig?: TenantPermissionConfig | null,
): boolean {
  return resolvePermissions(user, tenantConfig).has(permission);
}

export function listPermissions(
  user: UserLike,
  tenantConfig?: TenantPermissionConfig | null,
): Permission[] {
  return [...resolvePermissions(user, tenantConfig)].sort();
}
