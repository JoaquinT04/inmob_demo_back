import type { FastifyReply, FastifyRequest } from 'fastify';
import { Tenant } from '@inmob/database';
import { TenantRegistry } from '@inmob/platform';
import {
  SubscriptionStatus,
  TenantStatus,
  PlanLimits,
  type TenantPlan,
} from '@inmob/shared';

export async function checkLicense(request: FastifyRequest, reply: FastifyReply) {
  const auth = request.auth;
  if (!auth) return;

  const platformEm = request.server.platformOrm.em.fork();
  const registry = await platformEm.findOne(TenantRegistry, { subdomain: auth.subdomain });

  if (!registry) {
    return reply.status(404).send({ error: 'Tenant no encontrado', code: 'TENANT_NOT_FOUND' });
  }

  if (registry.status === TenantStatus.CANCELLED) {
    return reply.status(403).send({
      error: 'Cuenta cancelada. Contactar soporte para reactivar.',
      code: 'ACCOUNT_CANCELLED',
    });
  }

  if (registry.status === TenantStatus.SUSPENDED) {
    const method = request.method.toUpperCase();
    if (method !== 'GET') {
      return reply.status(403).send({
        error: 'Cuenta suspendida por falta de pago. Solo lectura habilitada.',
        code: 'ACCOUNT_SUSPENDED',
        billingUrl: '/settings/billing',
      });
    }
    return;
  }

  if (registry.subscriptionStatus === SubscriptionStatus.TRIALING && registry.trialEndsAt) {
    if (registry.trialEndsAt < new Date()) {
      registry.status = TenantStatus.SUSPENDED;
      registry.subscriptionStatus = SubscriptionStatus.EXPIRED;
      await platformEm.flush();

      return reply.status(402).send({
        error: 'Período de prueba vencido. Activar una suscripción para continuar.',
        code: 'TRIAL_EXPIRED',
        billingUrl: '/settings/billing',
      });
    }

    const daysLeft = Math.ceil(
      (registry.trialEndsAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
    );
    reply.header('X-Trial-Days-Left', String(daysLeft));
  }

  if (registry.subscriptionStatus === SubscriptionStatus.PAST_DUE) {
    reply.header('X-Billing-Warning', 'payment_failed');
  }
}

type PlanLimitKey = keyof (typeof PlanLimits)[TenantPlan];

export function enforcePlanLimit(
  limitKey: PlanLimitKey,
  countFn: (em: import('@mikro-orm/postgresql').EntityManager) => Promise<number>,
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = request.auth;
    if (!auth) return;

    const platformEm = request.server.platformOrm.em.fork();
    const registry = await platformEm.findOne(TenantRegistry, { subdomain: auth.subdomain });
    if (!registry) return;

    const limits = PlanLimits[registry.plan];
    const max = limits[limitKey] as number;

    if (max === -1) return;

    const tenantEm = request.orm.em.fork();
    const current = await countFn(tenantEm);

    if (current >= max) {
      return reply.status(402).send({
        error: `Límite de ${String(limitKey)} alcanzado para el plan ${registry.plan} (máx: ${max}).`,
        code: 'PLAN_LIMIT_REACHED',
        limit: max,
        current,
        upgradeUrl: '/settings/billing',
      });
    }
  };
}

export function requirePlanFeature(feature: keyof (typeof PlanLimits)[TenantPlan]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = request.auth;
    if (!auth) return;

    const platformEm = request.server.platformOrm.em.fork();
    const registry = await platformEm.findOne(TenantRegistry, { subdomain: auth.subdomain });
    if (!registry) return;

    const limits = PlanLimits[registry.plan];
    const allowed = limits[feature] as boolean;

    if (!allowed) {
      return reply.status(402).send({
        error: `La funcionalidad "${String(feature)}" no está disponible en el plan ${registry.plan}.`,
        code: 'FEATURE_NOT_IN_PLAN',
        feature,
        upgradeUrl: '/settings/billing',
      });
    }
  };
}
