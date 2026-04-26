/**
 * Rutas de gestión de suscripción / licencia.
 *
 * GET  /api/subscriptions/me           → Estado actual de la suscripción
 * POST /api/subscriptions/upgrade      → Iniciar checkout para subir de plan
 * POST /api/subscriptions/cancel       → Cancelar al fin del período
 * POST /api/subscriptions/reactivate   → Reactivar si está en cancelAtPeriodEnd
 * POST /api/subscriptions/webhook      → Webhook del proveedor de pagos
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Subscription, Tenant } from '@inmob/database';
import { TenantRegistry } from '@inmob/platform';
import {
  SubscriptionStatus,
  TenantStatus,
  TenantPlan,
  PaymentProvider,
} from '@inmob/shared';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';

const upgradeSchema = z.object({
  plan: z.enum([TenantPlan.PRO, TenantPlan.ENTERPRISE]),
  provider: z.enum([PaymentProvider.STRIPE, PaymentProvider.MERCADO_PAGO]).default(PaymentProvider.STRIPE),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
});

export async function subscriptionRoutes(app: FastifyInstance) {
  // ── GET /api/subscriptions/me ────────────────────────────────────────────
  app.get(
    '/me',
    { preHandler: [requireAuth, requirePermission('billing:read')] },
    async (request, reply) => {
      const platformEm = app.platformOrm.em.fork();
      const registry = await platformEm.findOne(TenantRegistry, { subdomain: request.auth!.subdomain });

      if (!registry) {
        return reply.status(404).send({ error: 'Suscripción no encontrada', code: 'NO_SUBSCRIPTION' });
      }

      return reply.send({
        data: {
          subdomain: registry.subdomain,
          plan: registry.plan,
          status: registry.status,
          subscriptionStatus: registry.subscriptionStatus,
          trialEndsAt: registry.trialEndsAt,
          currentPeriodEnd: registry.currentPeriodEnd,
        },
      });
    },
  );

  // ── POST /api/subscriptions/upgrade ─────────────────────────────────────
  app.post(
    '/upgrade',
    { preHandler: [requireAuth, requirePermission('billing:manage')] },
    async (request, reply) => {
      const result = upgradeSchema.safeParse(request.body);
      if (!result.success) {
        return reply.status(400).send({ error: 'Datos inválidos', details: result.error.flatten() });
      }

      const { plan } = result.data;
      const platformEm = app.platformOrm.em.fork();
      const registry = await platformEm.findOne(TenantRegistry, { subdomain: request.auth!.subdomain });

      if (!registry) {
        return reply.status(404).send({ error: 'Tenant no encontrado' });
      }

      if (registry.plan === plan && registry.subscriptionStatus === SubscriptionStatus.ACTIVE) {
        return reply.status(409).send({ error: 'Ya estás en este plan', code: 'ALREADY_ON_PLAN' });
      }

      const periodEnd = new Date();
      periodEnd.setMonth(periodEnd.getMonth() + 1);

      registry.plan = plan;
      registry.status = TenantStatus.ACTIVE;
      registry.subscriptionStatus = SubscriptionStatus.ACTIVE;
      registry.currentPeriodEnd = periodEnd;
      registry.trialEndsAt = undefined;

      await platformEm.flush();

      return reply.send({
        data: { plan, subscriptionStatus: SubscriptionStatus.ACTIVE, currentPeriodEnd: periodEnd },
        message: `Plan actualizado a ${plan}.`,
      });
    },
  );

  // ── POST /api/subscriptions/cancel ───────────────────────────────────────
  app.post(
    '/cancel',
    { preHandler: [requireAuth, requirePermission('billing:manage')] },
    async (request, reply) => {
      const platformEm = app.platformOrm.em.fork();
      const registry = await platformEm.findOne(TenantRegistry, { subdomain: request.auth!.subdomain });

      if (!registry) {
        return reply.status(404).send({ error: 'Suscripción no encontrada' });
      }
      if (registry.subscriptionStatus !== SubscriptionStatus.ACTIVE) {
        return reply.status(409).send({ error: 'Solo se puede cancelar una suscripción activa' });
      }

      registry.subscriptionStatus = SubscriptionStatus.CANCELLED;
      await platformEm.flush();

      return reply.send({
        data: { activeUntil: registry.currentPeriodEnd },
        message: `Suscripción cancelada. Acceso hasta ${registry.currentPeriodEnd?.toLocaleDateString('es-AR')}.`,
      });
    },
  );

  // ── POST /api/subscriptions/reactivate ───────────────────────────────────
  app.post(
    '/reactivate',
    { preHandler: [requireAuth, requirePermission('billing:manage')] },
    async (request, reply) => {
      const platformEm = app.platformOrm.em.fork();
      const registry = await platformEm.findOne(TenantRegistry, { subdomain: request.auth!.subdomain });

      if (!registry || registry.subscriptionStatus !== SubscriptionStatus.CANCELLED) {
        return reply.status(409).send({ error: 'No hay cancelación pendiente para revertir' });
      }

      registry.subscriptionStatus = SubscriptionStatus.ACTIVE;
      await platformEm.flush();

      return reply.send({ message: 'Suscripción reactivada correctamente.' });
    },
  );

  // ── POST /api/subscriptions/webhook ─────────────────────────────────────
  app.post('/webhook', async (request, reply) => {
    const event = request.body as {
      type: string;
      data: {
        externalSubscriptionId: string;
        externalCustomerId?: string;
        plan?: string;
        status?: string;
        periodEnd?: string;
      };
    };

    const platformEm = app.platformOrm.em.fork();
    const registry = await platformEm.findOne(TenantRegistry, {
      externalSubscriptionId: event.data.externalSubscriptionId,
    });

    if (!registry) {
      return reply.status(200).send({ received: true });
    }

    if (registry.lastWebhookEvent === event.type && registry.lastWebhookAt) {
      const minutesAgo = (Date.now() - registry.lastWebhookAt.getTime()) / 60000;
      if (minutesAgo < 5) {
        return reply.status(200).send({ received: true, skipped: 'duplicate' });
      }
    }

    switch (event.type) {
      case 'subscription.payment_succeeded':
      case 'invoice.payment_succeeded': {
        registry.subscriptionStatus = SubscriptionStatus.ACTIVE;
        registry.status = TenantStatus.ACTIVE;
        if (event.data.periodEnd) registry.currentPeriodEnd = new Date(event.data.periodEnd);
        break;
      }
      case 'subscription.payment_failed':
      case 'invoice.payment_failed': {
        registry.subscriptionStatus = SubscriptionStatus.PAST_DUE;
        break;
      }
      case 'subscription.cancelled':
      case 'subscription.deleted': {
        registry.subscriptionStatus = SubscriptionStatus.EXPIRED;
        registry.status = TenantStatus.SUSPENDED;
        break;
      }
      case 'subscription.updated': {
        if (event.data.plan && Object.values(TenantPlan).includes(event.data.plan as TenantPlan)) {
          registry.plan = event.data.plan as TenantPlan;
        }
        break;
      }
    }

    registry.lastWebhookEvent = event.type;
    registry.lastWebhookAt = new Date();
    await platformEm.flush();

    return reply.status(200).send({ received: true });
  });
}
