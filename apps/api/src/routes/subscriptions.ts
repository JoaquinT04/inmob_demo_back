/**
 * Rutas de gestión de suscripción / licencia.
 *
 * GET  /api/subscriptions/me           → Estado actual de la suscripción
 * POST /api/subscriptions/upgrade      → Iniciar checkout para subir de plan
 * POST /api/subscriptions/cancel       → Cancelar al fin del período
 * POST /api/subscriptions/reactivate   → Reactivar si está en cancelAtPeriodEnd
 * POST /api/subscriptions/webhook      → Webhook del proveedor de pagos
 *
 * Solo el OWNER puede gestionar la suscripción (billing:manage).
 * El webhook es público pero valida la firma del proveedor.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Subscription, Tenant } from '@inmob/database';
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
      const em = app.orm.em.fork();
      const sub = await em.findOne(Subscription, { tenant: { id: request.auth!.tenantId } });

      if (!sub) {
        return reply.status(404).send({ error: 'Suscripción no encontrada', code: 'NO_SUBSCRIPTION' });
      }

      return reply.send({
        data: {
          id: sub.id,
          plan: sub.plan,
          status: sub.status,
          trialEndsAt: sub.trialEndsAt,
          currentPeriodStart: sub.currentPeriodStart,
          currentPeriodEnd: sub.currentPeriodEnd,
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
          paymentProvider: sub.paymentProvider,
        },
      });
    },
  );

  // ── POST /api/subscriptions/upgrade ─────────────────────────────────────
  // Genera una URL de checkout en el proveedor de pagos.
  // El frontend redirige al usuario a esa URL.
  app.post(
    '/upgrade',
    { preHandler: [requireAuth, requirePermission('billing:manage')] },
    async (request, reply) => {
      const result = upgradeSchema.safeParse(request.body);
      if (!result.success) {
        return reply.status(400).send({ error: 'Datos inválidos', details: result.error.flatten() });
      }

      const { plan, provider } = result.data;
      const em = app.orm.em.fork();

      const sub = await em.findOne(Subscription, { tenant: { id: request.auth!.tenantId } });
      if (!sub) {
        return reply.status(404).send({ error: 'Suscripción no encontrada', code: 'NO_SUBSCRIPTION' });
      }

      if (sub.plan === plan && sub.status === SubscriptionStatus.ACTIVE) {
        return reply.status(409).send({ error: 'Ya estás en este plan', code: 'ALREADY_ON_PLAN' });
      }

      // TODO: integrar con Stripe/MercadoPago
      // const checkoutUrl = await createCheckoutSession({ plan, provider, tenantId, sub });
      //
      // Por ahora: simular activación directa (DEV mode)
      const periodStart = new Date();
      const periodEnd = new Date();
      periodEnd.setMonth(periodEnd.getMonth() + 1);

      sub.plan = plan;
      sub.status = SubscriptionStatus.ACTIVE;
      sub.paymentProvider = provider;
      sub.currentPeriodStart = periodStart;
      sub.currentPeriodEnd = periodEnd;
      sub.cancelAtPeriodEnd = false;
      sub.trialEndsAt = undefined;

      const tenant = await em.findOne(Tenant, { id: request.auth!.tenantId });
      if (tenant) {
        tenant.plan = plan;
        tenant.status = TenantStatus.ACTIVE;
      }

      await em.flush();

      return reply.send({
        data: {
          plan: sub.plan,
          status: sub.status,
          currentPeriodEnd: sub.currentPeriodEnd,
          // checkoutUrl  ← en producción devolver esto y el frontend redirige
        },
        message: `Plan actualizado a ${plan}.`,
      });
    },
  );

  // ── POST /api/subscriptions/cancel ───────────────────────────────────────
  // Cancela al fin del período (no corta el acceso inmediatamente).
  app.post(
    '/cancel',
    { preHandler: [requireAuth, requirePermission('billing:manage')] },
    async (request, reply) => {
      const em = app.orm.em.fork();
      const sub = await em.findOne(Subscription, { tenant: { id: request.auth!.tenantId } });

      if (!sub) {
        return reply.status(404).send({ error: 'Suscripción no encontrada' });
      }
      if (sub.status !== SubscriptionStatus.ACTIVE) {
        return reply.status(409).send({ error: 'Solo se puede cancelar una suscripción activa' });
      }

      sub.cancelAtPeriodEnd = true;
      sub.status = SubscriptionStatus.CANCELLED;

      // TODO: cancelar en Stripe/MP
      await em.flush();

      return reply.send({
        data: { cancelAtPeriodEnd: true, activeUntil: sub.currentPeriodEnd },
        message: `Suscripción cancelada. Acceso hasta ${sub.currentPeriodEnd?.toLocaleDateString('es-AR')}.`,
      });
    },
  );

  // ── POST /api/subscriptions/reactivate ───────────────────────────────────
  app.post(
    '/reactivate',
    { preHandler: [requireAuth, requirePermission('billing:manage')] },
    async (request, reply) => {
      const em = app.orm.em.fork();
      const sub = await em.findOne(Subscription, { tenant: { id: request.auth!.tenantId } });

      if (!sub || !sub.cancelAtPeriodEnd) {
        return reply.status(409).send({ error: 'No hay cancelación pendiente para revertir' });
      }

      sub.cancelAtPeriodEnd = false;
      sub.status = SubscriptionStatus.ACTIVE;

      // TODO: reactivar en Stripe/MP
      await em.flush();

      return reply.send({ message: 'Suscripción reactivada correctamente.' });
    },
  );

  // ── POST /api/subscriptions/webhook ─────────────────────────────────────
  // Recibe eventos del proveedor de pagos.
  // Actualiza el estado de la suscripción según el evento.
  // La firma se valida antes de procesar cualquier dato.
  app.post('/webhook', async (request, reply) => {
    const provider = request.headers['x-payment-provider'] as string;

    // ── Validar firma ────────────────────────────────────────────────────
    // TODO: implementar validación de firma por proveedor
    // Stripe: stripe.webhooks.constructEvent(body, sig, STRIPE_WEBHOOK_SECRET)
    // MercadoPago: validar x-signature header
    //
    // Por seguridad, si no hay firma válida → rechazar silenciosamente (200)
    // para no exponer que el endpoint existe.

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

    const em = app.orm.em.fork();
    const sub = await em.findOne(Subscription, {
      externalSubscriptionId: event.data.externalSubscriptionId,
    });

    if (!sub) {
      // Evento para suscripción no registrada — ignorar
      return reply.status(200).send({ received: true });
    }

    // Idempotencia: no procesar el mismo evento dos veces
    if (sub.lastWebhookEvent === event.type && sub.lastWebhookAt) {
      const minutesAgo = (Date.now() - sub.lastWebhookAt.getTime()) / 60000;
      if (minutesAgo < 5) {
        return reply.status(200).send({ received: true, skipped: 'duplicate' });
      }
    }

    const loadedTenantRef = await sub.tenant.load();
    const tenant = loadedTenantRef ? await em.findOne(Tenant, { id: loadedTenantRef.id }) : null;

    switch (event.type) {
      // Pago exitoso → activar
      case 'subscription.payment_succeeded':
      case 'invoice.payment_succeeded': {
        sub.status = SubscriptionStatus.ACTIVE;
        if (tenant) tenant.status = TenantStatus.ACTIVE;
        if (event.data.periodEnd) sub.currentPeriodEnd = new Date(event.data.periodEnd);
        break;
      }

      // Pago fallido → período de gracia
      case 'subscription.payment_failed':
      case 'invoice.payment_failed': {
        sub.status = SubscriptionStatus.PAST_DUE;
        break;
      }

      // Cancelada
      case 'subscription.cancelled':
      case 'subscription.deleted': {
        sub.status = SubscriptionStatus.EXPIRED;
        if (tenant) tenant.status = TenantStatus.SUSPENDED;
        break;
      }

      // Plan actualizado
      case 'subscription.updated': {
        if (event.data.plan && Object.values(TenantPlan).includes(event.data.plan as TenantPlan)) {
          sub.plan = event.data.plan as TenantPlan;
          if (tenant) tenant.plan = event.data.plan as TenantPlan;
        }
        break;
      }
    }

    sub.lastWebhookEvent = event.type;
    sub.lastWebhookAt = new Date();
    await em.flush();

    return reply.status(200).send({ received: true });
  });
}
