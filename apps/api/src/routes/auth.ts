import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { Tenant, User } from '@inmob/database';
import { TenantRegistry } from '@inmob/platform';
import { requireAuth, signToken } from '../middleware/auth.js';
import { listPermissions } from '../utils/permissions.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function authRoutes(app: FastifyInstance) {
  // ── POST /api/auth/login ─────────────────────────────────────────────────
  // Subdomain resolved by tenant-routing hook into request.orm
  app.post('/login', async (request, reply) => {
    const result = loginSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Datos inválidos', details: result.error.flatten() });
    }

    const { email, password } = result.data;
    const subdomain = request.tenantSubdomain;
    const em = request.orm.em.fork();

    const user = await em.findOne(User, { email });
    if (!user) {
      return reply.status(401).send({ error: 'Email o contraseña incorrectos', code: 'INVALID_CREDENTIALS' });
    }

    if (!user.isActive) {
      return reply.status(403).send({ error: 'Usuario inactivo', code: 'USER_INACTIVE' });
    }

    if (!user.passwordHash) {
      return reply.status(401).send({ error: 'Este usuario no tiene contraseña configurada', code: 'NO_PASSWORD' });
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      return reply.status(401).send({ error: 'Email o contraseña incorrectos', code: 'INVALID_CREDENTIALS' });
    }

    user.lastLoginAt = new Date();
    await em.flush();

    const tenant = await em.findOne(Tenant, {});
    const token = await signToken({ userId: user.id, subdomain });
    const permissions = listPermissions(user, tenant?.permissionConfig);

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
        subdomain,
        name: tenant?.name ?? subdomain,
        logoUrl: tenant?.logoUrl ?? null,
        plan: tenant?.plan,
        status: tenant?.status,
      },
    });
  });

  // ── POST /api/auth/logout ────────────────────────────────────────────────
  app.post('/logout', async (_req, reply) => {
    return reply.status(204).send();
  });

  // ── GET /api/auth/me ─────────────────────────────────────────────────────
  app.get('/me', { preHandler: requireAuth }, async (request, reply) => {
    const auth = request.auth!;
    const em = request.orm.em.fork();

    const user = await em.findOne(User, { id: auth.userId });
    if (!user) {
      return reply.status(404).send({ error: 'Usuario no encontrado', code: 'USER_NOT_FOUND' });
    }

    const tenant = await em.findOne(Tenant, {});
    const permissions = listPermissions(user, tenant?.permissionConfig);

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
        subdomain: auth.subdomain,
        name: tenant?.name ?? auth.subdomain,
        logoUrl: tenant?.logoUrl ?? null,
        plan: tenant?.plan,
        status: tenant?.status,
      },
      permissions,
    });
  });

  // ── GET /api/auth/users ──────────────────────────────────────────────────
  // Lists active users for the resolved subdomain tenant (dev login selector)
  app.get('/users', async (request, reply) => {
    const em = request.orm.em.fork();
    const users = await em.find(User, { isActive: true }, { orderBy: { firstName: 'ASC' } });
    const tenant = await em.findOne(Tenant, {});

    return reply.send({
      tenant: { subdomain: request.tenantSubdomain, name: tenant?.name ?? request.tenantSubdomain },
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
