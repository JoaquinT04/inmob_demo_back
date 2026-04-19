import { Entity, ManyToOne, OneToOne, Property, Ref } from '@mikro-orm/core';
import { SubscriptionStatus, TenantPlan, PaymentProvider } from '@inmob/shared';
import { BaseEntity } from './BaseEntity.js';
import { Tenant } from './Tenant.entity.js';

/**
 * Suscripción / licencia de un tenant.
 *
 * Ciclo de vida:
 *   registro → TRIALING (plan FREE, trialEndsAt = hoy + TRIAL_DAYS)
 *   pago     → ACTIVE   (plan actualizado, currentPeriodEnd = hoy + 30d)
 *   falla    → PAST_DUE (período de gracia 7 días)
 *   no paga  → EXPIRED  (acceso bloqueado, tenant.status = SUSPENDED)
 *   cancela  → CANCELLED (activa hasta currentPeriodEnd, luego EXPIRED)
 *
 * El webhook del proveedor de pagos actualiza este registro.
 * El middleware license.ts lee este registro en cada request para enforcement.
 */
@Entity({ tableName: 'subscriptions' })
export class Subscription extends BaseEntity {
  @OneToOne(() => Tenant, { inversedBy: 'subscription', ref: true })
  tenant!: Ref<Tenant>;

  @Property()
  plan: TenantPlan = TenantPlan.FREE;

  @Property()
  status: SubscriptionStatus = SubscriptionStatus.TRIALING;

  /** Fin del trial. null si ya pasó al plan pago. */
  @Property({ nullable: true })
  trialEndsAt?: Date;

  /** Inicio del período de facturación actual */
  @Property({ nullable: true })
  currentPeriodStart?: Date;

  /** Fin del período de facturación actual */
  @Property({ nullable: true })
  currentPeriodEnd?: Date;

  /** Si true: no renueva al vencimiento (ya canceló, activo hasta currentPeriodEnd) */
  @Property()
  cancelAtPeriodEnd: boolean = false;

  /** Proveedor de pagos usado */
  @Property({ type: 'string', nullable: true })
  paymentProvider?: PaymentProvider;

  /**
   * ID de la suscripción en el proveedor externo.
   * Stripe: sub_xxx | MercadoPago: preapproval_xxx | null en trial/manual.
   */
  @Property({ nullable: true })
  externalSubscriptionId?: string;

  /**
   * ID del customer en el proveedor externo.
   * Necesario para crear checkout sessions y facturar.
   */
  @Property({ nullable: true })
  externalCustomerId?: string;

  /** Último evento de webhook recibido (para idempotencia y debugging) */
  @Property({ nullable: true })
  lastWebhookEvent?: string;

  @Property({ nullable: true })
  lastWebhookAt?: Date;
}
