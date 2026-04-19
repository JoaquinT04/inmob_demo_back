// ─── Estados del tenant ───────────────────────────────────────────────────────

export const TenantStatus = {
  /** Período de prueba gratuito (TRIAL_DAYS días desde el registro) */
  TRIAL: 'trial',
  /** Cuenta activa con suscripción vigente */
  ACTIVE: 'active',
  /** Suspendida por falta de pago (acceso de solo lectura) */
  SUSPENDED: 'suspended',
  /** Cancelada por el cliente (sin acceso) */
  CANCELLED: 'cancelled',
} as const;

export type TenantStatus = (typeof TenantStatus)[keyof typeof TenantStatus];

// ─── Planes de suscripción ────────────────────────────────────────────────────

export const TenantPlan = {
  FREE: 'free',
  PRO: 'pro',
  ENTERPRISE: 'enterprise',
} as const;

export type TenantPlan = (typeof TenantPlan)[keyof typeof TenantPlan];

// ─── Límites por plan ─────────────────────────────────────────────────────────
//
// -1 = sin límite
// Estos límites se validan en el license middleware en cada request relevante.

export const PlanLimits = {
  [TenantPlan.FREE]: {
    maxUsers: 3,
    maxProperties: 20,
    maxPhotosPerProperty: 5,
    canExport: false,
    canUsePortals: false,
    canUseHub: false,
    canUseApi: false,
    supportLevel: 'community',
  },
  [TenantPlan.PRO]: {
    maxUsers: 15,
    maxProperties: 500,
    maxPhotosPerProperty: 20,
    canExport: true,
    canUsePortals: true,
    canUseHub: true,
    canUseApi: false,
    supportLevel: 'email',
  },
  [TenantPlan.ENTERPRISE]: {
    maxUsers: -1,
    maxProperties: -1,
    maxPhotosPerProperty: 50,
    canExport: true,
    canUsePortals: true,
    canUseHub: true,
    canUseApi: true,
    supportLevel: 'priority',
  },
} as const;

export type PlanLimit = (typeof PlanLimits)[TenantPlan];

// ─── Estado de suscripción ────────────────────────────────────────────────────

export const SubscriptionStatus = {
  /** Trial activo */
  TRIALING: 'trialing',
  /** Activa y al día con pagos */
  ACTIVE: 'active',
  /** Pago fallido, en período de gracia */
  PAST_DUE: 'past_due',
  /** Cancelada, activa hasta fin del período */
  CANCELLED: 'cancelled',
  /** Expirada, sin acceso */
  EXPIRED: 'expired',
} as const;

export type SubscriptionStatus = (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];

// ─── Proveedores de pago ──────────────────────────────────────────────────────

export const PaymentProvider = {
  STRIPE: 'stripe',
  MERCADO_PAGO: 'mercadopago',
  MANUAL: 'manual',
} as const;

export type PaymentProvider = (typeof PaymentProvider)[keyof typeof PaymentProvider];
