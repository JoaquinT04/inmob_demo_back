import { Entity, ManyToOne, Property, Ref } from '@mikro-orm/core';
import { BaseEntity } from './BaseEntity.js';
import { Tenant } from './Tenant.entity.js';
import { User } from './User.entity.js';
import { Property as PropertyEntity } from './Property.entity.js';
import { Lead } from './Lead.entity.js';

@Entity({ tableName: 'agenda_events' })
export class Agenda extends BaseEntity {
  @Property()
  title!: string;

  @Property()
  type!: 'visit' | 'meeting' | 'call' | 'reminder' | 'other';

  @Property({ type: 'text', nullable: true })
  description?: string;

  @Property()
  startsAt!: Date;

  @Property({ nullable: true })
  endsAt?: Date;

  @Property({ default: false })
  allDay: boolean = false;

  @Property({ nullable: true })
  location?: string;

  @ManyToOne(() => Tenant, { ref: true })
  tenant!: Ref<Tenant>;

  @ManyToOne(() => User, { ref: true })
  createdBy!: Ref<User>;

  @ManyToOne(() => PropertyEntity, { ref: true, nullable: true })
  property?: Ref<PropertyEntity>;

  @ManyToOne(() => Lead, { ref: true, nullable: true })
  lead?: Ref<Lead>;
}
