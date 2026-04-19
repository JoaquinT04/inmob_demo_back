import { Entity, Filter, ManyToOne, Property, Ref } from '@mikro-orm/core';
import type { SystemGroup, SystemRole, UserPermissionOverrides, UserPreferences } from '@inmob/shared';
import { BaseEntity } from './BaseEntity.js';
import { Tenant } from './Tenant.entity.js';

/**
 * Usuario del sistema.
 *
 * MULTI-TENANT: El filtro 'byTenant' asegura que las queries solo devuelvan
 * usuarios del tenant activo. Siempre activar con em.addFilter('byTenant', ...).
 *
 * La autenticación la maneja Clerk en producción.
 * En DEV_BYPASS_AUTH mode se usa passwordHash + JWT local (jose).
 */
@Entity({ tableName: 'users' })
@Filter({
  name: 'byTenant',
  cond: (args: { tenantId: string }) => ({ tenant: { id: args.tenantId } }),
  default: false,
})
export class User extends BaseEntity {
  /** ID de Clerk — puente entre Clerk y nuestra DB. En dev: "dev_<timestamp>" */
  @Property({ unique: true })
  clerkId!: string;

  @Property()
  email!: string;

  /** Email para envío de correos (puede diferir del login) */
  @Property({ nullable: true })
  smtpEmail?: string;

  @Property()
  firstName!: string;

  @Property()
  lastName!: string;

  @Property({ nullable: true })
  phone?: string;

  @Property({ nullable: true })
  avatarUrl?: string;

  @Property({ type: 'text', nullable: true })
  emailSignature?: string;

  /**
   * Roles del usuario en este tenant.
   * En general un usuario tiene un rol. El owner siempre tiene ['owner'].
   * Array para soporte futuro de multi-rol.
   */
  @Property({ type: 'json' })
  roles: SystemRole[] = [];

  @Property({ default: true })
  isActive: boolean = true;

  @Property({ default: false })
  twoFactorEnabled: boolean = false;

  @Property({ type: 'json' })
  preferences: UserPreferences = {
    theme: 'dark',
    language: 'es',
    timezone: 'America/Argentina/Buenos_Aires',
  };

  @Property({ nullable: true })
  lastLoginAt?: Date;

  /**
   * Hash de contraseña — solo para DEV_BYPASS_AUTH mode.
   * NUNCA se usa en producción (auth delegada a Clerk).
   */
  @Property({ nullable: true })
  passwordHash?: string;

  /**
   * Grupos de permisos adicionales.
   * El grupo 'base:user' se aplica implícitamente — no hace falta incluirlo.
   * Solo se guardan los grupos extras asignados desde la UI de permisos.
   */
  @Property({ type: 'json', nullable: true })
  groups?: SystemGroup[];

  /**
   * Overrides individuales: grant/deny específicos por usuario.
   * Configurados desde Configuraciones → Usuarios → editar usuario.
   * Los deny tienen prioridad sobre todo (capa 5 del sistema).
   */
  @Property({ type: 'json', nullable: true })
  permissionOverrides?: UserPermissionOverrides;

  @ManyToOne(() => Tenant, { ref: true })
  tenant!: Ref<Tenant>;
}
