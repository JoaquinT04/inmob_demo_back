/**
 * Rutas de autenticación — JWT nativo.
 *
 * POST /api/auth/login      → Login con email + password + tenantSlug
 * POST /api/auth/logout     → Logout (stateless — el cliente borra el token)
 * GET  /api/auth/me         → Usuario actual + permisos resueltos
 * GET  /api/auth/users      → Listar usuarios del tenant (para selector de login en dev)
 */
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { Tenant, User } from '@inmob/database';
import { requireAuth, signToken } from '../middleware/auth.js';
import { listPermissions } from '../utils/permissions.js';

const loginSchema = z.object({
  email: z.string().email(),
  tenantSlug: z.string().min(1),
  password: z.string().min(1),
});

export async function authRoutes(app: FastifyInstance) {
  // ── POST /api/auth/login ─────────────────────────────────────────────────
  app.post('/login', async (request, reply) => {
    const result = loginSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Datos inválidos', details: result.error.flatten() });
    }

    const { email, tenantSlug, password } = result.data;
    const em = app.orm.em.fork();

    const tenant = await em.findOne(Tenant, { slug: tenantSlug });
    if (!tenant) {
      return reply.status(404).send({
        error: `Inmobiliaria "${tenantSlug}" no encontrada`,
        code: 'TENANT_NOT_FOUND',
      });
    }

    const user = await em.findOne(User, { email, tenant: { id: tenant.id } });
    if (!user) {
      return reply.status(401).send({ error: 'Email o contraseña incorrectos', code: 'INVALID_CREDENTIALS' });
    }

    if (!user.isActive) {
      return reply.status(403).send({ error: 'Usuario inactivo', code: 'USER_INACTIVE' });
    }

    if (!user.passwordHash) {
      return reply.status(401).send({
        error: 'Este usuario no tiene contraseña configurada',
        code: 'NO_PASSWORD',
      });
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      return reply.status(401).send({ error: 'Email o contraseña incorrectos', code: 'INVALID_CREDENTIALS' });
    }

    user.lastLoginAt = new Date();
    await em.flush();

    const token = await signToken({ userId: user.id, tenantId: tenant.id });
    const permissions = listPermissions(user, tenant.permissionConfig);

    return reply.send({
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        avatarUrl: user.avatarUrl ?? null,
        roles: user.roles,
        groups: user.groups ?? [],
        permissions,
      },
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        logoUrl: tenant.logoUrl ?? null,
        plan: tenant.plan,
        status: tenant.status,
      },
    });
  });

  // ── POST /api/auth/logout ────────────────────────────────────────────────
  // El token JWT es stateless — el cliente simplemente lo descarta.
  // Este endpoint existe para que el flujo de logout sea explícito en la API.
  // En una implementación futura con refresh tokens, aquí se revocarían.
  app.post('/logout', async (_req, reply) => {
    return reply.status(204).send();
  });

  // ── GET /api/auth/me ─────────────────────────────────────────────────────
  app.get('/me', { preHandler: requireAuth }, async (request, reply) => {
    const auth = request.auth!;
    const em = app.orm.em.fork();

    const user = await em.findOne(User, { id: auth.userId });
    if (!user) {
      return reply.status(404).send({ error: 'Usuario no encontrado', code: 'USER_NOT_FOUND' });
    }

    const tenant = await em.findOne(Tenant, { id: auth.tenantId });
    if (!tenant) {
      return reply.status(404).send({ error: 'Inmobiliaria no encontrada', code: 'TENANT_NOT_FOUND' });
    }

    const permissions = listPermissions(user, tenant.permissionConfig);

    return reply.send({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        avatarUrl: user.avatarUrl ?? null,
        roles: user.roles,
        groups: user.groups ?? [],
        preferences: user.preferences,
        permissionOverrides: user.permissionOverrides ?? null,
        isActive: user.isActive,
        lastLoginAt: user.lastLoginAt ?? null,
      },
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        logoUrl: tenant.logoUrl ?? null,
        plan: tenant.plan,
        status: tenant.status,
      },
      permissions,
    });
  });

  // ── GET /api/auth/users ──────────────────────────────────────────────────
  // Lista los usuarios de un tenant — útil en el selector de login del dev.
  // En producción: solo disponible si el tenant tiene habilitado el self-service.
  app.get('/users', async (request, reply) => {
    const { tenant: tenantSlug } = request.query as { tenant?: string };

    if (!tenantSlug) {
      return reply.status(400).send({ error: 'Parámetro "tenant" requerido' });
    }

    const em = app.orm.em.fork();
    const tenant = await em.findOne(Tenant, { slug: tenantSlug });

    if (!tenant) {
      return reply.status(404).send({ error: `Inmobiliaria "${tenantSlug}" no encontrada` });
    }

    const users = await em.find(
      User,
      { tenant: { id: tenant.id }, isActive: true },
      { orderBy: { roles: 'ASC', firstName: 'ASC' } },
    );

    return reply.send({
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        roles: u.roles,
        hasPassword: !!u.passwordHash,
      })),
    });
  });
}
