import { Collection, Entity, OneToMany, OneToOne, Property, Ref } from '@mikro-orm/core';
import type {
  TenantPermissionConfig,
  TenantSettings,
  TenantAddress,
} from '@inmob/shared';
import { TenantStatus, TenantPlan } from '@inmob/shared';
import { BaseEntity } from './BaseEntity.js';
import { User } from './User.entity.js';
import { Subscription } from './Subscription.entity.js';
import { Property as PropertyEntity } from './Property.entity.js';
import { PortalConnection } from './PortalConnection.entity.js';

@Entity({ tableName: 'tenants' })
export class Tenant extends BaseEntity {
  /** Nombre comercial (visible en la app) */
  @Property()
  name!: string;

  /** Identificador único legible. Ej: "inmobiliaria-garcia" */
  @Property({ unique: true })
  slug!: string;

  @Property()
  status: TenantStatus = TenantStatus.TRIAL;

  @Property()
  plan: TenantPlan = TenantPlan.FREE;

  /** Razón social legal */
  @Property({ nullable: true })
  legalName?: string;

  /** CUIT / identificación fiscal */
  @Property({ nullable: true })
  taxId?: string;

  /** URL del logo */
  @Property({ nullable: true })
  logoUrl?: string;

  /** URL imagen de portada */
  @Property({ nullable: true })
  coverImageUrl?: string;

  @Property({ type: 'json', nullable: true })
  address?: TenantAddress;

  @Property({ type: 'json' })
  settings: TenantSettings = {};

  /**
   * Overrides de permisos por rol para este tenant.
   * null = usar RolePermissions sin modificaciones.
   * El owner/admin puede personalizar desde Configuraciones → Permisos.
   */
  @Property({ type: 'json', nullable: true })
  permissionConfig?: TenantPermissionConfig;

  /** Suscripción activa (una por tenant) */
  @OneToOne(() => Subscription, { mappedBy: 'tenant', nullable: true })
  subscription?: Ref<Subscription>;

  @OneToMany(() => User, (u) => u.tenant)
  users = new Collection<User>(this);

  @OneToMany(() => PropertyEntity, (p) => p.tenant)
  properties = new Collection<PropertyEntity>(this);

  @OneToMany(() => PortalConnection, (pc) => pc.tenant)
  portalConnections = new Collection<PortalConnection>(this);
}
