import { Entity, ManyToOne, Property, Ref } from '@mikro-orm/core';
import type { ContactType } from '@inmob/shared';
import { BaseEntity } from './BaseEntity.js';
import { Tenant } from './Tenant.entity.js';
import { User } from './User.entity.js';

@Entity({ tableName: 'contacts' })
export class Contact extends BaseEntity {
  @Property()
  firstName!: string;

  @Property({ nullable: true })
  lastName?: string;

  @Property({ nullable: true })
  email?: string;

  @Property({ nullable: true })
  phone?: string;

  @Property({ nullable: true })
  whatsapp?: string;

  @Property({ type: 'string' })
  type!: ContactType;

  @Property({ nullable: true })
  source?: string;

  @Property({ type: 'text', nullable: true })
  notes?: string;

  @Property({ type: 'json' })
  tags: string[] = [];

  @ManyToOne(() => Tenant, { ref: true })
  tenant!: Ref<Tenant>;

  @ManyToOne(() => User, { ref: true, nullable: true })
  assignedUser?: Ref<User>;
}
