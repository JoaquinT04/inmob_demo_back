import { Entity, Filter, ManyToOne, Property as Prop, Ref } from '@mikro-orm/core';
import type { Currency, OperationType, PropertyStatus, PropertyType } from '@inmob/shared';
import { BaseEntity } from './BaseEntity.js';
import { Tenant } from './Tenant.entity.js';
import { User } from './User.entity.js';

@Entity({ tableName: 'properties' })
@Filter({
  name: 'byTenant',
  cond: (args: { tenantId: string }) => ({ tenant: { id: args.tenantId } }),
  default: false,
})
export class Property extends BaseEntity {
  @Prop()
  title!: string;

  @Prop({ unique: true })
  slug!: string;

  @Prop({ type: 'text', nullable: true })
  description?: string;

  @Prop({ type: 'string' })
  type!: PropertyType;

  @Prop({ type: 'string' })
  operationType!: OperationType;

  @Prop({ type: 'string' })
  status!: PropertyStatus;

  @Prop({ type: 'decimal', precision: 15, scale: 2 })
  price!: number;

  @Prop({ type: 'string' })
  currency!: Currency;

  @Prop({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  expenses?: number;

  @Prop({ type: 'json' })
  address!: {
    street: string;
    number?: string;
    neighborhood?: string;
    city: string;
    state: string;
    zipCode?: string;
    country: string;
    coordinates?: { lat: number; lng: number };
    showExactAddress: boolean;
  };

  @Prop({ type: 'json' })
  features: {
    totalArea?: number;
    coveredArea?: number;
    rooms?: number;
    bedrooms?: number;
    bathrooms?: number;
    garages?: number;
    age?: number;
  } = {};

  @Prop({ type: 'json' })
  amenities: string[] = [];

  @Prop({ type: 'json' })
  images: {
    id: string;
    url: string;
    thumbnailUrl?: string;
    alt?: string;
    order: number;
    isPrimary: boolean;
  }[] = [];

  @Prop({ nullable: true })
  publishedAt?: Date;

  @ManyToOne(() => Tenant, { ref: true })
  tenant!: Ref<Tenant>;

  @ManyToOne(() => User, { ref: true, nullable: true })
  assignedUser?: Ref<User>;
}
