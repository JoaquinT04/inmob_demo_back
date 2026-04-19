/**
 * Middleware de enforcement de licencia.
 *
 * Lee la Subscription del tenant en cada request relevante y bloquea
 * operaciones que excedan el plan activo o si la cuenta está suspendida.
 *
 * Uso:
 *   app.post('/properties', {
 *     preHandler: [requireAuth, checkLicense, requirePermission('property:create')]
 *   }, handler)
 *
 * Para límites específicos (ej: maxProperties), usar los helpers:
 *   preHandler: [requireAuth, enforcePlanLimit('maxProperties')]
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Subscription, Tenant } from '@inmob/database';
import {
  SubscriptionStatus,
  TenantStatus,
  PlanLimits,
  type TenantPlan,
} from '@inmob/shared';

// ─── Estado de cuenta ─────────────────────────────────────────────────────────
//
// SUSPENDED: Solo lectura (GET). Bloquea POST/PUT/PATCH/DELETE.
// EXPIRED / CANCELLED: Bloquea todo (401).
// PAST_DUE: Período de gracia 7 días → permite todo con advertencia en header.
// TRIALING / ACTIVE: Acceso normal, pero sujeto a PlanLimits.

export async function checkLicense(request: FastifyRequest, reply: FastifyReply) {
  const auth = request.auth;
  if (!auth) return; // requireAuth ya rechazó antes de llegar aquí

  const em = request.server.orm.em.fork();
  const tenant = await em.findOne(Tenant, { id: auth.tenantId });

  if (!tenant) {
    return reply.status(404).send({ error: 'Tenant no encontrado', code: 'TENANT_NOT_FOUND' });
  }

  // Cuenta cancelada o expirada → sin acceso
  if (tenant.status === TenantStatus.CANCELLED) {
    return reply.status(403).send({
      error: 'Cuenta cancelada. Contactar soporte para reactivar.',
      code: 'ACCOUNT_CANCELLED',
    });
  }

  // Cuenta suspendida → solo GET
  if (tenant.status === TenantStatus.SUSPENDED) {
    const method = request.method.toUpperCase();
    if (method !== 'GET') {
      return reply.status(403).send({
        error: 'Cuenta suspendida por falta de pago. Solo lectura habilitada.',
        code: 'ACCOUNT_SUSPENDED',
        billingUrl: '/settings/billing',
      });
    }
    return; // GET pasa
  }

  // Verificar trial expirado
  const sub = await em.findOne(Subscription, { tenant: { id: auth.tenantId } });
  if (sub?.status === SubscriptionStatus.TRIALING && sub.trialEndsAt) {
    if (sub.trialEndsAt < new Date()) {
      // Trial expiró — suspender el tenant
      tenant.status = TenantStatus.SUSPENDED;
      sub.status = SubscriptionStatus.EXPIRED;
      await em.flush();

      return reply.status(402).send({
        error: 'Período de prueba vencido. Activar una suscripción para continuar.',
        code: 'TRIAL_EXPIRED',
        billingUrl: '/settings/billing',
      });
    }

    // Advertir en header cuántos días quedan
    const daysLeft = Math.ceil(
      (sub.trialEndsAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
    );
    reply.header('X-Trial-Days-Left', String(daysLeft));
  }

  // Past due: período de gracia (advertencia, no bloqueo)
  if (sub?.status === SubscriptionStatus.PAST_DUE) {
    reply.header('X-Billing-Warning', 'payment_failed');
  }
}

// ─── Enforcement de límites por plan ─────────────────────────────────────────

type PlanLimitKey = keyof (typeof PlanLimits)[TenantPlan];

/**
 * Factory: genera un preHandler que verifica un límite numérico del plan.
 *
 * Ejemplo: enforcePlanLimit('maxProperties') cuenta las propiedades del tenant
 * y rechaza con 402 si ya alcanzó el máximo del plan.
 *
 * @param limitKey  - Clave en PlanLimits (ej: 'maxProperties', 'maxUsers')
 * @param countFn   - Función que cuenta los recursos actuales del tenant
 */
export function enforcePlanLimit(
  limitKey: PlanLimitKey,
  countFn: (tenantId: string, em: import('@mikro-orm/postgresql').EntityManager) => Promise<number>,
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = request.auth;
    if (!auth) return;

    const em = request.server.orm.em.fork();
    const tenant = await em.findOne(Tenant, { id: auth.tenantId });
    if (!tenant) return;

    const limits = PlanLimits[tenant.plan];
    const max = limits[limitKey] as number;

    if (max === -1) return; // Sin límite (enterprise)

    const current = await countFn(auth.tenantId, em);

    if (current >= max) {
      return reply.status(402).send({
        error: `Límite de ${String(limitKey)} alcanzado para el plan ${tenant.plan} (máx: ${max}).`,
        code: 'PLAN_LIMIT_REACHED',
        limit: max,
        current,
        upgradeUrl: '/settings/billing',
      });
    }
  };
}

/**
 * Verifica que el plan permite una feature booleana.
 *
 * Ejemplo: requirePlanFeature('canUsePortals')
 */
export function requirePlanFeature(feature: keyof (typeof PlanLimits)[TenantPlan]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = request.auth;
    if (!auth) return;

    const em = request.server.orm.em.fork();
    const tenant = await em.findOne(Tenant, { id: auth.tenantId });
    if (!tenant) return;

    const limits = PlanLimits[tenant.plan];
    const allowed = limits[feature] as boolean;

    if (!allowed) {
      return reply.status(402).send({
        error: `La funcionalidad "${String(feature)}" no está disponible en el plan ${tenant.plan}.`,
        code: 'FEATURE_NOT_IN_PLAN',
        feature,
        upgradeUrl: '/settings/billing',
      });
    }
  };
}
