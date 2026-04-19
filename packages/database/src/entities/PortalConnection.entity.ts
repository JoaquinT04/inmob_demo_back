import { Entity, Filter, ManyToOne, Property, Ref } from '@mikro-orm/core';
import type { PortalConnectionStatus, PortalType } from '@inmob/shared';
import { BaseEntity } from './BaseEntity.js';
import { Tenant } from './Tenant.entity.js';

@Entity({ tableName: 'portal_connections' })
@Filter({
  name: 'byTenant',
  cond: (args: { tenantId: string }) => ({ tenant: { id: args.tenantId } }),
  default: false,
})
export class PortalConnection extends BaseEntity {
  @Property({ type: 'string' })
  portal!: PortalType;

  @Property({ type: 'string' })
  status!: PortalConnectionStatus;

  /** Credenciales encriptadas en reposo — NUNCA exponer al cliente */
  @Property({ type: 'json', nullable: true })
  encryptedCredentials?: Record<string, string>;

  @Property({ nullable: true })
  lastSyncAt?: Date;

  @Property({ nullable: true })
  errorMessage?: string;

  @ManyToOne(() => Tenant, { ref: true })
  tenant!: Ref<Tenant>;
}
