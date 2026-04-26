import { Entity, Property } from '@mikro-orm/core';
import { Opt, PrimaryKey } from '@mikro-orm/core';
import type { TenantSettings } from '@inmob/shared';
import { TenantPlan, TenantStatus, SubscriptionStatus, PaymentProvider } from '@inmob/shared';

@Entity({ tableName: 'tenant_registry' })
export class TenantRegistry {
  @PrimaryKey({ type: 'uuid' })
  id: string & Opt = crypto.randomUUID();

  /** Subdominio único. "garcia" → garcia.tudominio.com */
  @Property({ unique: true })
  subdomain!: string;

  @Property()
  name!: string;

  @Property()
  ownerEmail!: string;

  /** Connection string a la DB privada de este tenant */
  @Property({ unique: true })
  databaseUrl!: string;

  @Property({ type: 'string' })
  plan: TenantPlan = TenantPlan.FREE;

  @Property({ type: 'string' })
  status: TenantStatus = TenantStatus.TRIAL;

  @Property({ type: 'string' })
  subscriptionStatus: SubscriptionStatus = SubscriptionStatus.TRIALING;

  @Property({ nullable: true })
  trialEndsAt?: Date;

  @Property({ nullable: true })
  currentPeriodEnd?: Date;

  @Property({ default: false })
  cancelAtPeriodEnd: boolean & Opt = false;

  @Property({ type: 'string', nullable: true })
  paymentProvider?: PaymentProvider;

  @Property({ nullable: true })
  externalCustomerId?: string;

  @Property({ nullable: true })
  externalSubscriptionId?: string;

  @Property({ nullable: true })
  logoUrl?: string;

  @Property({ nullable: true })
  taxId?: string;

  @Property({ type: 'json', nullable: true })
  settings?: TenantSettings;

  /** Último webhook recibido del proveedor de pagos (idempotencia) */
  @Property({ nullable: true })
  lastWebhookEvent?: string;

  @Property({ nullable: true })
  lastWebhookAt?: Date;

  @Property()
  createdAt: Date & Opt = new Date();

  @Property({ onUpdate: () => new Date() })
  updatedAt: Date & Opt = new Date();
}
