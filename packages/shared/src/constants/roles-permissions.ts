// ─── Roles del sistema ────────────────────────────────────────────────────────
//
// Jerarquía: owner > administrador > coordinador > agente > captador
// El owner es el único que puede gestionar billing/licencias.
// Los tenants no pueden crear ni eliminar estos roles del sistema.

export const SystemRole = {
  OWNER: 'owner',
  ADMINISTRADOR: 'administrador',
  COORDINADOR: 'coordinador',
  AGENTE: 'agente',
  CAPTADOR: 'captador',
} as const;

export type SystemRole = (typeof SystemRole)[keyof typeof SystemRole];

export const SystemRoleLabel: Record<SystemRole, string> = {
  [SystemRole.OWNER]: 'Owner',
  [SystemRole.ADMINISTRADOR]: 'Administrador',
  [SystemRole.COORDINADOR]: 'Coordinador',
  [SystemRole.AGENTE]: 'Agente',
  [SystemRole.CAPTADOR]: 'Captador',
};

// ─── Recursos y acciones (RBAC) ───────────────────────────────────────────────

export const Resource = {
  PROPERTY: 'property',
  CONTACT: 'contact',
  CRM: 'crm',
  AGENDA: 'agenda',
  HUB: 'hub',
  USER: 'user',
  ROLE: 'role',
  REPORT: 'report',
  SETTINGS: 'settings',
  BILLING: 'billing',
} as const;

export type Resource = (typeof Resource)[keyof typeof Resource];

export const Action = {
  CREATE: 'create',
  READ: 'read',
  UPDATE: 'update',
  DELETE: 'delete',
  EXPORT: 'export',
  PUBLISH: 'publish',
  MANAGE: 'manage',
} as const;

export type Action = (typeof Action)[keyof typeof Action];

export type Permission = `${Resource}:${Action}`;

// ─── Permisos por rol ─────────────────────────────────────────────────────────
//
// Sistema de 5 capas (inspirado en Odoo):
//   1. base:user     → mínimos garantizados a todo usuario autenticado (implícito)
//   2. Role baseline → RolePermissions[role]
//   3. Tenant overrides → el admin customiza por rol desde el panel
//   4. User groups   → grupos adicionales asignados al usuario
//   5. User overrides → grant/deny individuales (max granularidad)
//
// Capas 1-4 son aditivas. En capa 5, los "deny" tienen prioridad sobre todo.

export const RolePermissions: Record<SystemRole, Permission[]> = {
  [SystemRole.OWNER]: [
    // Acceso total — único rol con billing
    'property:create', 'property:read', 'property:update', 'property:delete', 'property:export', 'property:publish',
    'contact:create', 'contact:read', 'contact:update', 'contact:delete', 'contact:export',
    'crm:create', 'crm:read', 'crm:update', 'crm:delete', 'crm:manage',
    'agenda:create', 'agenda:read', 'agenda:update', 'agenda:delete', 'agenda:manage',
    'hub:create', 'hub:read', 'hub:update', 'hub:delete', 'hub:publish',
    'user:create', 'user:read', 'user:update', 'user:delete', 'user:manage',
    'role:create', 'role:read', 'role:update', 'role:delete', 'role:manage',
    'report:create', 'report:read', 'report:export',
    'settings:read', 'settings:update', 'settings:manage',
    'billing:read', 'billing:update', 'billing:manage',
  ],
  [SystemRole.ADMINISTRADOR]: [
    // Todo excepto billing y eliminar la empresa
    'property:create', 'property:read', 'property:update', 'property:delete', 'property:export', 'property:publish',
    'contact:create', 'contact:read', 'contact:update', 'contact:delete', 'contact:export',
    'crm:create', 'crm:read', 'crm:update', 'crm:delete', 'crm:manage',
    'agenda:create', 'agenda:read', 'agenda:update', 'agenda:delete', 'agenda:manage',
    'hub:create', 'hub:read', 'hub:update', 'hub:delete', 'hub:publish',
    'user:create', 'user:read', 'user:update', 'user:delete', 'user:manage',
    'role:create', 'role:read', 'role:update', 'role:delete',
    'report:create', 'report:read', 'report:export',
    'settings:read', 'settings:update',
  ],
  [SystemRole.COORDINADOR]: [
    // Gestión operativa: propiedades, contactos, CRM, equipo (readonly)
    'property:create', 'property:read', 'property:update', 'property:delete', 'property:publish',
    'contact:create', 'contact:read', 'contact:update', 'contact:delete',
    'crm:create', 'crm:read', 'crm:update', 'crm:delete',
    'agenda:create', 'agenda:read', 'agenda:update', 'agenda:delete',
    'hub:read', 'hub:create', 'hub:publish',
    'user:read',
    'report:create', 'report:read', 'report:export',
    'settings:read',
  ],
  [SystemRole.AGENTE]: [
    // Propiedades y contactos propios, CRM, agenda
    'property:create', 'property:read', 'property:update', 'property:publish',
    'contact:create', 'contact:read', 'contact:update',
    'crm:create', 'crm:read', 'crm:update',
    'agenda:create', 'agenda:read', 'agenda:update',
    'hub:read', 'hub:publish',
    'report:read',
  ],
  [SystemRole.CAPTADOR]: [
    // Solo carga propiedades, sin CRM ni reportes
    'property:create', 'property:read', 'property:update',
    'hub:read',
  ],
};

// ─── Grupos de permisos (ortogonales a los roles) ─────────────────────────────
//
// Un captador con grupo "report:viewer" puede ver reportes sin cambiar su rol.
// Los grupos se asignan desde Configuraciones → Usuarios.

export const SystemGroup = {
  BASE_USER: 'base:user',
  PROPERTY_VIEWER: 'property:viewer',
  PROPERTY_EDITOR: 'property:editor',
  PROPERTY_MANAGER: 'property:manager',
  CONTACT_VIEWER: 'contact:viewer',
  CONTACT_EDITOR: 'contact:editor',
  CONTACT_MANAGER: 'contact:manager',
  CRM_VIEWER: 'crm:viewer',
  CRM_MANAGER: 'crm:manager',
  REPORT_VIEWER: 'report:viewer',
  REPORT_MANAGER: 'report:manager',
  SETTINGS_VIEWER: 'settings:viewer',
  USER_MANAGER: 'user:manager',
  HUB_PUBLISHER: 'hub:publisher',
} as const;

export type SystemGroup = (typeof SystemGroup)[keyof typeof SystemGroup];

export interface PermissionGroupDef {
  id: SystemGroup;
  name: string;
  description: string;
  permissions: Permission[];
  impliedGroups?: SystemGroup[];
}

export const GroupDefinitions: Record<SystemGroup, PermissionGroupDef> = {
  'base:user': {
    id: 'base:user',
    name: 'Usuario base',
    description: 'Permisos mínimos garantizados a cualquier usuario autenticado. No se puede quitar.',
    permissions: ['property:read', 'contact:read', 'hub:read'],
  },
  'property:viewer': {
    id: 'property:viewer',
    name: 'Propiedades — Visualizador',
    description: 'Puede ver propiedades.',
    permissions: ['property:read'],
    impliedGroups: ['base:user'],
  },
  'property:editor': {
    id: 'property:editor',
    name: 'Propiedades — Editor',
    description: 'Puede crear y editar propiedades.',
    permissions: ['property:create', 'property:read', 'property:update'],
    impliedGroups: ['property:viewer'],
  },
  'property:manager': {
    id: 'property:manager',
    name: 'Propiedades — Gestor',
    description: 'Control total: publicar, eliminar y exportar propiedades.',
    permissions: [
      'property:create', 'property:read', 'property:update',
      'property:delete', 'property:publish', 'property:export',
    ],
    impliedGroups: ['property:editor'],
  },
  'contact:viewer': {
    id: 'contact:viewer',
    name: 'Contactos — Visualizador',
    permissions: ['contact:read'],
    description: 'Puede ver contactos.',
    impliedGroups: ['base:user'],
  },
  'contact:editor': {
    id: 'contact:editor',
    name: 'Contactos — Editor',
    permissions: ['contact:create', 'contact:read', 'contact:update'],
    description: 'Puede crear y editar contactos.',
    impliedGroups: ['contact:viewer'],
  },
  'contact:manager': {
    id: 'contact:manager',
    name: 'Contactos — Gestor',
    permissions: ['contact:create', 'contact:read', 'contact:update', 'contact:delete', 'contact:export'],
    description: 'Control total sobre contactos.',
    impliedGroups: ['contact:editor'],
  },
  'crm:viewer': {
    id: 'crm:viewer',
    name: 'CRM — Visualizador',
    permissions: ['crm:read'],
    description: 'Puede ver el pipeline CRM.',
    impliedGroups: ['base:user'],
  },
  'crm:manager': {
    id: 'crm:manager',
    name: 'CRM — Gestor',
    permissions: ['crm:create', 'crm:read', 'crm:update', 'crm:delete', 'crm:manage'],
    description: 'Control total sobre el CRM.',
    impliedGroups: ['crm:viewer'],
  },
  'report:viewer': {
    id: 'report:viewer',
    name: 'Reportes — Visualizador',
    permissions: ['report:read'],
    description: 'Puede ver reportes.',
    impliedGroups: ['base:user'],
  },
  'report:manager': {
    id: 'report:manager',
    name: 'Reportes — Gestor',
    permissions: ['report:create', 'report:read', 'report:export'],
    description: 'Puede crear y exportar reportes.',
    impliedGroups: ['report:viewer'],
  },
  'settings:viewer': {
    id: 'settings:viewer',
    name: 'Configuración — Visualizador',
    permissions: ['settings:read'],
    description: 'Puede ver la configuración del tenant (solo lectura).',
    impliedGroups: ['base:user'],
  },
  'user:manager': {
    id: 'user:manager',
    name: 'Usuarios — Gestor',
    permissions: ['user:create', 'user:read', 'user:update', 'user:manage'],
    description: 'Puede invitar, editar y desactivar usuarios del tenant.',
    impliedGroups: ['base:user'],
  },
  'hub:publisher': {
    id: 'hub:publisher',
    name: 'Hub — Publicador',
    permissions: ['hub:create', 'hub:read', 'hub:publish'],
    description: 'Puede publicar propiedades en el hub compartido entre inmobiliarias.',
    impliedGroups: ['base:user'],
  },
};

export function resolveGroupPermissions(
  groupId: SystemGroup,
  visited = new Set<string>(),
): Set<Permission> {
  if (visited.has(groupId)) return new Set<Permission>();
  visited.add(groupId);

  const def = GroupDefinitions[groupId];
  const result = new Set<Permission>(def.permissions);

  for (const implied of def.impliedGroups ?? []) {
    for (const p of resolveGroupPermissions(implied, visited)) {
      result.add(p);
    }
  }

  return result;
}

// ─── Secciones de menú ────────────────────────────────────────────────────────
//
// Restricciones de menú se almacenan como "deny overrides" con prefijo "menu:".
// El layout filtra los ítems de navegación según estos valores.

export const MenuSection = {
  DASHBOARD: 'menu:dashboard',
  PROPERTIES: 'menu:properties',
  HUB: 'menu:hub',
  CRM: 'menu:crm',
  CONTACTS: 'menu:contacts',
  AGENDA: 'menu:agenda',
  REPORTS: 'menu:reports',
  SETTINGS: 'menu:settings',
} as const;

export type MenuSection = (typeof MenuSection)[keyof typeof MenuSection];
