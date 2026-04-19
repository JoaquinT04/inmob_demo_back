/**
 * POST /api/register
 *
 * Crea atómicamente en una transacción:
 *   1. Tenant (inmobiliaria)
 *   2. User con role=owner
 *   3. Subscription en estado TRIALING (TRIAL_DAYS días desde hoy)
 *
 * El registro devuelve siempre un JWT — el owner puede hacer login inmediatamente.
 *
 * Futuro: para integrar Clerk/Auth0, agregar aquí la creación del usuario
 * en el proveedor externo y guardar el externalId en user.clerkId.
 * El contrato de respuesta no cambia.
 */
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { Tenant, User, Subscription } from '@inmob/database';
import {
  TenantStatus,
  TenantPlan,
  SubscriptionStatus,
  SystemRole,
  slugify,
  registerSchema,
} from '@inmob/shared';
import { signToken } from '../middleware/auth.js';
import { listPermissions } from '../utils/permissions.js';

const TRIAL_DAYS = Number(process.env['TRIAL_DAYS'] ?? 14);

export async function registerRoutes(app: FastifyInstance) {
  /**
   * POST /api/register
   *
   * Body: RegisterInput (ver packages/shared/src/schemas/register.schema.ts)
   *
   * Response 201:
   *   { tenant, user, subscription, token, permissions, message }
   */
  app.post('/', async (request, reply) => {
    const result = registerSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({
        error: 'Datos inválidos',
        details: result.error.flatten().fieldErrors,
      });
    }

    const {
      agencyName,
      slug: rawSlug,
      ownerEmail,
      ownerFirstName,
      ownerLastName,
      ownerPhone,
      taxId,
      country,
      timezone,
      password,
    } = result.data;

    const em = app.orm.em.fork();

    // ── Validaciones previas (fuera de transacción para errores claros) ────
    const slug = rawSlug ?? slugify(agencyName);

    const slugTaken = await em.findOne(Tenant, { slug });
    if (slugTaken) {
      return reply.status(409).send({
        error: `El slug "${slug}" ya está en uso. Elegir otro nombre.`,
        code: 'SLUG_TAKEN',
      });
    }

    const emailTaken = await em.findOne(User, { email: ownerEmail });
    if (emailTaken) {
      return reply.status(409).send({
        error: 'Ya existe una cuenta con ese email.',
        code: 'EMAIL_TAKEN',
      });
    }

    if (!password) {
      return reply.status(400).send({
        error: 'La contraseña es requerida para el registro.',
        code: 'PASSWORD_REQUIRED',
      });
    }

    // ── Transacción atómica: Tenant + Subscription + User ─────────────────
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + TRIAL_DAYS);

    await em.begin();
    try {
      const tenant = em.create(Tenant, {
        name: agencyName,
        slug,
        status: TenantStatus.TRIAL,
        plan: TenantPlan.FREE,
        taxId,
        settings: {
          locale: {
            country,
            language: 'es',
            timezone,
            currency: country === 'AR' ? 'ARS' : 'USD',
          },
        },
      });

      const subscription = em.create(Subscription, {
        tenant: tenant as never,
        plan: TenantPlan.FREE,
        status: SubscriptionStatus.TRIALING,
        trialEndsAt,
        cancelAtPeriodEnd: false,
      });

      const passwordHash = await bcrypt.hash(password, 10);

      // clerkId: campo heredado del modelo — en MVP usamos el propio userId.
      // Al integrar Clerk/Auth0 se actualiza con el ID del proveedor externo.
      const tempId = crypto.randomUUID();
      const owner = em.create(User, {
        clerkId: tempId, // Se sobreescribe abajo con el ID real
        email: ownerEmail,
        firstName: ownerFirstName,
        lastName: ownerLastName,
        phone: ownerPhone,
        roles: [SystemRole.OWNER],
        isActive: true,
        twoFactorEnabled: false,
        preferences: {
          theme: 'dark',
          language: 'es',
          timezone,
        },
        tenant: tenant as never,
        passwordHash,
      });

      await em.flush();

      // Actualizar clerkId con el ID real de la DB (autorreferencia en MVP)
      owner.clerkId = owner.id;
      await em.flush();
      await em.commit();

      const token = await signToken({ userId: owner.id, tenantId: tenant.id });
      const permissions = listPermissions(owner);

      return reply.status(201).send({
        token,
        permissions,
        tenant: {
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
          status: tenant.status,
          plan: tenant.plan,
        },
        subscription: {
          id: subscription.id,
          status: subscription.status,
          trialEndsAt: subscription.trialEndsAt,
          plan: subscription.plan,
        },
        user: {
          id: owner.id,
          email: owner.email,
          firstName: owner.firstName,
          lastName: owner.lastName,
          roles: owner.roles,
        },
        message: `Inmobiliaria "${agencyName}" creada. Trial activo hasta ${trialEndsAt.toLocaleDateString('es-AR')}.`,
      });
    } catch (err) {
      await em.rollback();
      throw err;
    }
  });

  /**
   * GET /api/register/check-slug/:slug
   *
   * Verifica disponibilidad de slug en tiempo real (para el formulario de registro).
   * Endpoint público — sin autenticación.
   */
  app.get('/check-slug/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length < 3 || slug.length > 50) {
      return reply.status(400).send({
        available: false,
        error: 'Slug inválido. Solo minúsculas, números y guiones (3-50 caracteres).',
      });
    }

    const em = app.orm.em.fork();
    const existing = await em.findOne(Tenant, { slug });

    return { available: !existing, slug };
  });
}
