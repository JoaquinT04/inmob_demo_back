/**
 * Rutas de gestión de suscripción / licencia y pagos.
 *
 * GET  /api/subscriptions/plans                → Catálogo de planes (público)
 * GET  /api/subscriptions/me                   → Estado de suscripción del tenant
 * POST /api/subscriptions/checkout             → Crear sesión de pago MercadoPago
 * GET  /api/subscriptions/checkout/success     → Redirect de MP tras pago aprobado
 * GET  /api/subscriptions/checkout/failure     → Redirect de MP tras pago rechazado
 * POST /api/subscriptions/cancel               → Cancelar al fin del período
 * POST /api/subscriptions/reactivate           → Reactivar cancelación pendiente
 * POST /api/subscriptions/webhook/mercadopago  → Webhook IPN de MercadoPago
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MercadoPagoConfig, Preference, Payment } from 'mercadopago';
import { TenantRegistry } from '@inmob/platform';
import {
  SubscriptionStatus,
  TenantStatus,
  TenantPlan,
  PaymentProvider,
  PlanLimits,
  PlanPricing,
} from '@inmob/shared';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';

// ─── MercadoPago client ───────────────────────────────────────────────────────

function getMpClient(): MercadoPagoConfig {
  const token = process.env['MP_ACCESS_TOKEN'];
  if (!token) throw new Error('MP_ACCESS_TOKEN no configurado');
  return new MercadoPagoConfig({ accessToken: token });
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const checkoutSchema = z.object({
  plan: z.enum([TenantPlan.PRO, TenantPlan.ENTERPRISE]),
  successUrl: z.string().url().optional(),
  failureUrl: z.string().url().optional(),
});

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function subscriptionRoutes(app: FastifyInstance) {

  // ── GET /api/subscriptions/plans ─────────────────────────────────────────
  // Público — no requiere auth ni X-Tenant.
  app.get('/plans', async (_request, reply) => {
    const plans = Object.values(TenantPlan).map((plan) => ({
      id: plan,
      ...PlanPricing[plan],
      limits: PlanLimits[plan],
    }));
    return reply.send({ data: plans });
  });

  // ── GET /api/subscriptions/me ─────────────────────────────────────────────
  app.get(
    '/me',
    { preHandler: [requireAuth, requirePermission('billing:read')] },
    async (request, reply) => {
      const platformEm = app.platformOrm.em.fork();
      const registry = await platformEm.findOne(TenantRegistry, { subdomain: request.auth!.subdomain });

      if (!registry) {
        return reply.status(404).send({ error: 'Suscripción no encontrada', code: 'NO_SUBSCRIPTION' });
      }

      const now = new Date();
      const trialDaysLeft = registry.trialEndsAt
        ? Math.max(0, Math.ceil((registry.trialEndsAt.getTime() - now.getTime()) / 86_400_000))
        : null;

      return reply.send({
        data: {
          subdomain: registry.subdomain,
          plan: registry.plan,
          planLimits: PlanLimits[registry.plan],
          planPricing: PlanPricing[registry.plan],
          status: registry.status,
          subscriptionStatus: registry.subscriptionStatus,
          trialEndsAt: registry.trialEndsAt,
          trialDaysLeft,
          currentPeriodEnd: registry.currentPeriodEnd,
          cancelAtPeriodEnd: registry.cancelAtPeriodEnd,
          paymentProvider: registry.paymentProvider,
        },
      });
    },
  );

  // ── POST /api/subscriptions/checkout ─────────────────────────────────────
  // Crea una preferencia de MercadoPago y devuelve la URL de checkout.
  // El frontend redirige al usuario a checkoutUrl.
  app.post(
    '/checkout',
    { preHandler: [requireAuth, requirePermission('billing:manage')] },
    async (request, reply) => {
      const result = checkoutSchema.safeParse(request.body);
      if (!result.success) {
        return reply.status(400).send({ error: 'Datos inválidos', details: result.error.flatten() });
      }

      const { plan, successUrl, failureUrl } = result.data;
      const subdomain = request.auth!.subdomain;

      const platformEm = app.platformOrm.em.fork();
      const registry = await platformEm.findOne(TenantRegistry, { subdomain });
      if (!registry) {
        return reply.status(404).send({ error: 'Tenant no encontrado' });
      }

      if (registry.plan === plan && registry.subscriptionStatus === SubscriptionStatus.ACTIVE) {
        return reply.status(409).send({ error: 'Ya estás en este plan', code: 'ALREADY_ON_PLAN' });
      }

      const pricing = PlanPricing[plan];
      const appUrl = process.env['APP_URL'] ?? 'https://inmob-demo-back.onrender.com';
      const frontendUrl = process.env['FRONTEND_URL'] ?? appUrl;

      try {
        const mpClient = getMpClient();
        const preference = new Preference(mpClient);

        const pref = await preference.create({
          body: {
            items: [{
              id: plan,
              title: `Plan ${pricing.label} — ${registry.name}`,
              quantity: 1,
              unit_price: pricing.price,
              currency_id: pricing.currency,
            }],
            payer: { email: registry.ownerEmail },
            back_urls: {
              success: successUrl ?? `${appUrl}/api/subscriptions/checkout/success`,
              failure: failureUrl ?? `${appUrl}/api/subscriptions/checkout/failure`,
              pending: `${appUrl}/api/subscriptions/checkout/pending`,
            },
            auto_return: 'approved',
            // external_reference codifica subdomain|plan para recuperarlo en webhook/redirect
            external_reference: `${subdomain}|${plan}`,
            notification_url: `${appUrl}/api/subscriptions/webhook/mercadopago`,
            statement_descriptor: 'INMOB',
          },
        });

        // Guardar preferenceId para idempotencia posterior
        registry.paymentProvider = PaymentProvider.MERCADO_PAGO;
        await platformEm.flush();

        const isProduction = process.env['NODE_ENV'] === 'production';
        return reply.send({
          checkoutUrl: isProduction ? pref.init_point : pref.sandbox_init_point,
          preferenceId: pref.id,
          plan,
          pricing,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        app.log.error({ err }, 'MercadoPago checkout failed');
        return reply.status(502).send({ error: `Error al crear el checkout: ${msg}`, code: 'CHECKOUT_ERROR' });
      }
    },
  );

  // ── GET /api/subscriptions/checkout/success ───────────────────────────────
  // MercadoPago redirige aquí tras pago aprobado.
  // Activa el plan y redirige al frontend.
  app.get('/checkout/success', async (request, reply) => {
    const {
      collection_status,
      external_reference,
      collection_id,
      payment_id,
    } = request.query as Record<string, string>;

    const frontendUrl = process.env['FRONTEND_URL'] ?? '/';

    if (collection_status !== 'approved') {
      return reply.redirect(`${frontendUrl}/billing?status=pending&payment_id=${payment_id ?? ''}`);
    }

    const [subdomain, plan] = (external_reference ?? '').split('|');

    if (!subdomain || !plan || !Object.values(TenantPlan).includes(plan as TenantPlan)) {
      return reply.redirect(`${frontendUrl}/billing?status=error&reason=invalid_reference`);
    }

    const platformEm = app.platformOrm.em.fork();
    const registry = await platformEm.findOne(TenantRegistry, { subdomain });

    if (registry) {
      const periodEnd = new Date();
      periodEnd.setMonth(periodEnd.getMonth() + 1);
      registry.plan = plan as TenantPlan;
      registry.status = TenantStatus.ACTIVE;
      registry.subscriptionStatus = SubscriptionStatus.ACTIVE;
      registry.currentPeriodEnd = periodEnd;
      registry.trialEndsAt = undefined;
      registry.externalSubscriptionId = collection_id ?? payment_id ?? undefined;
      registry.paymentProvider = PaymentProvider.MERCADO_PAGO;
      await platformEm.flush();
    }

    return reply.redirect(`${frontendUrl}/billing?status=success&plan=${plan}`);
  });

  // ── GET /api/subscriptions/checkout/failure ───────────────────────────────
  app.get('/checkout/failure', async (request, reply) => {
    const { payment_id } = request.query as Record<string, string>;
    const frontendUrl = process.env['FRONTEND_URL'] ?? '/';
    return reply.redirect(`${frontendUrl}/billing?status=failed&payment_id=${payment_id ?? ''}`);
  });

  // ── GET /api/subscriptions/checkout/pending ───────────────────────────────
  app.get('/checkout/pending', async (request, reply) => {
    const { payment_id } = request.query as Record<string, string>;
    const frontendUrl = process.env['FRONTEND_URL'] ?? '/';
    return reply.redirect(`${frontendUrl}/billing?status=pending&payment_id=${payment_id ?? ''}`);
  });

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
      registry.cancelAtPeriodEnd = true;
      await platformEm.flush();

      return reply.send({
        data: { activeUntil: registry.currentPeriodEnd },
        message: `Suscripción cancelada. Acceso hasta ${registry.currentPeriodEnd?.toLocaleDateString('es-AR')}.`,
      });
    },
  );

  // ── POST /api/subscriptions/reactivate ────────────────────────────────────
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
      registry.cancelAtPeriodEnd = false;
      await platformEm.flush();

      return reply.send({ message: 'Suscripción reactivada correctamente.' });
    },
  );

  // ── POST /api/subscriptions/webhook/mercadopago ───────────────────────────
  // IPN de MercadoPago. MP envía { action, data: { id } } y espera 200.
  // Luego hay que buscar el pago por ID para obtener el external_reference.
  app.post('/webhook/mercadopago', async (request, reply) => {
    // Responder 200 de inmediato — MP requiere respuesta rápida
    reply.status(200).send({ received: true });

    const body = request.body as { action?: string; data?: { id?: string | number } };
    if (!body?.data?.id) return;

    // Solo procesar pagos (no suscripciones, merchant orders, etc.)
    const action = body.action ?? '';
    if (!action.startsWith('payment')) return;

    try {
      const mpClient = getMpClient();
      const paymentClient = new Payment(mpClient);
      const payment = await paymentClient.get({ id: String(body.data.id) });

      if (!payment.external_reference) return;

      const [subdomain, plan] = payment.external_reference.split('|');
      if (!subdomain || !plan) return;

      const platformEm = app.platformOrm.em.fork();
      const registry = await platformEm.findOne(TenantRegistry, { subdomain });
      if (!registry) return;

      const status = payment.status; // approved | pending | rejected | cancelled | refunded | charged_back

      if (status === 'approved') {
        const periodEnd = new Date();
        periodEnd.setMonth(periodEnd.getMonth() + 1);
        registry.plan = plan as TenantPlan;
        registry.status = TenantStatus.ACTIVE;
        registry.subscriptionStatus = SubscriptionStatus.ACTIVE;
        registry.currentPeriodEnd = periodEnd;
        registry.trialEndsAt = undefined;
        registry.externalSubscriptionId = String(payment.id);
        registry.paymentProvider = PaymentProvider.MERCADO_PAGO;
      } else if (status === 'rejected' || status === 'cancelled') {
        registry.subscriptionStatus = SubscriptionStatus.PAST_DUE;
      } else if (status === 'refunded' || status === 'charged_back') {
        registry.subscriptionStatus = SubscriptionStatus.EXPIRED;
        registry.status = TenantStatus.SUSPENDED;
      }

      registry.lastWebhookEvent = `payment.${status}`;
      registry.lastWebhookAt = new Date();
      await platformEm.flush();
    } catch (err) {
      app.log.error({ err, body }, 'MP webhook processing failed');
    }
  });
}
