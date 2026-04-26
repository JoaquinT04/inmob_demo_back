import { Entity, Property, Index } from '@mikro-orm/core';
import { Opt, PrimaryKey } from '@mikro-orm/core';
import type { Currency, OperationType, PropertyType } from '@inmob/shared';

/**
 * Propiedades publicadas de todos los tenants — el Hub público.
 *
 * Se sincroniza desde la API del tenant cuando el agente publica una propiedad.
 * Es la fuente de datos para portal.tudominio.com/hub.
 */
@Entity({ tableName: 'hub_properties' })
@Index({ name: 'idx_hub_tenant_external', properties: ['tenantSubdomain', 'externalId'] })
export class HubProperty {
  @PrimaryKey({ type: 'uuid' })
  id: string & Opt = crypto.randomUUID();

  /** Subdominio del tenant que publicó la propiedad */
  @Property()
  tenantSubdomain!: string;

  @Property()
  tenantName!: string;

  @Property({ nullable: true })
  tenantLogoUrl?: string;

  /** ID de la propiedad en la DB del tenant */
  @Property()
  externalId!: string;

  @Property()
  title!: string;

  @Property({ type: 'string' })
  type!: PropertyType;

  @Property({ type: 'string' })
  operationType!: OperationType;

  @Property({ type: 'decimal', precision: 15, scale: 2 })
  price!: number;

  @Property({ type: 'string' })
  currency!: Currency;

  @Property({ nullable: true })
  city?: string;

  @Property({ nullable: true })
  neighborhood?: string;

  @Property({ nullable: true })
  state?: string;

  @Property({ nullable: true })
  mainImageUrl?: string;

  /** Ambientes — para filtros del Hub */
  @Property({ nullable: true })
  rooms?: number;

  @Property({ nullable: true })
  publishedAt?: Date;

  @Property({ nullable: true })
  lastSyncAt?: Date;

  @Property()
  createdAt: Date & Opt = new Date();

  @Property({ onUpdate: () => new Date() })
  updatedAt: Date & Opt = new Date();
}
