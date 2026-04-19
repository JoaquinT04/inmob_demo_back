import { Entity, Filter, ManyToOne, Property, Ref } from '@mikro-orm/core';
import type { LeadStatus } from '@inmob/shared';
import { BaseEntity } from './BaseEntity.js';
import { Tenant } from './Tenant.entity.js';
import { Contact } from './Contact.entity.js';
import { Property as PropertyEntity } from './Property.entity.js';
import { User } from './User.entity.js';

@Entity({ tableName: 'leads' })
@Filter({
  name: 'byTenant',
  cond: (args: { tenantId: string }) => ({ tenant: { id: args.tenantId } }),
  default: false,
})
export class Lead extends BaseEntity {
  @Property({ type: 'string' })
  status!: LeadStatus;

  @Property({ nullable: true })
  source?: string;

  @Property({ type: 'text', nullable: true })
  notes?: string;

  @Property({ nullable: true })
  lostReason?: string;

  /** Actividades del lead: llamadas, mensajes, visitas */
  @Property({ type: 'json' })
  activities: {
    type: 'call' | 'email' | 'visit' | 'note' | 'message';
    content: string;
    userId: string;
    createdAt: string;
  }[] = [];

  @ManyToOne(() => Tenant, { ref: true })
  tenant!: Ref<Tenant>;

  @ManyToOne(() => Contact, { ref: true })
  contact!: Ref<Contact>;

  @ManyToOne(() => PropertyEntity, { ref: true, nullable: true })
  property?: Ref<PropertyEntity>;

  @ManyToOne(() => User, { ref: true, nullable: true })
  assignedUser?: Ref<User>;
}
