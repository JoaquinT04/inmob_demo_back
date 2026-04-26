import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { User, Tenant } from '@inmob/database';
import { SystemRole, SystemGroup, inviteUserSchema } from '@inmob/shared';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permissions.js';
import { listPermissions } from '../../utils/permissions.js';

const updateUserSchema = z.object({
  firstName: z.string().min(1).max(80).optional(),
  lastName: z.string().min(1).max(80).optional(),
  phone: z.string().max(30).optional(),
  role: z.enum([
    SystemRole.ADMINISTRADOR,
    SystemRole.COORDINADOR,
    SystemRole.AGENTE,
    SystemRole.CAPTADOR,
  ]).optional(),
  groups: z.array(z.string()).optional(),
  permissionOverrides: z.object({
    grant: z.array(z.string()),
    deny: z.array(z.string()),
  }).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(4).optional(),
});

export async function usersSettingsRoutes(app: FastifyInstance) {
  // ── GET /api/settings/users ──────────────────────────────────────────────
  app.get(
    '/',
    { preHandler: [requireAuth, requirePermission('user:read')] },
    async (request, reply) => {
      const em = request.orm.em.fork();
      const users = await em.find(User, {}, { orderBy: { firstName: 'ASC' } });

      return reply.send({
        data: users.map((u) => ({
          id: u.id,
          email: u.email,
          firstName: u.firstName,
          lastName: u.lastName,
          avatarUrl: u.avatarUrl,
          roles: u.roles,
          groups: u.groups ?? [],
          isActive: u.isActive,
          lastLoginAt: u.lastLoginAt,
          createdAt: u.createdAt,
        })),
      });
    },
  );

  // ── POST /api/settings/users (invitar) ───────────────────────────────────
  app.post(
    '/',
    { preHandler: [requireAuth, requirePermission('user:create')] },
    async (request, reply) => {
      const result = inviteUserSchema.safeParse(request.body);
      if (!result.success) {
        return reply.status(400).send({ error: 'Datos inválidos', details: result.error.flatten() });
      }

      const { email, firstName, lastName, role } = result.data;
      const em = request.orm.em.fork();

      const existing = await em.findOne(User, { email });
      if (existing) {
        return reply.status(409).send({ error: 'Ya existe un usuario con ese email' });
      }

      const tenant = await em.findOne(Tenant, {});

      const tempId = crypto.randomUUID();
      const user = em.create(User, {
        clerkId: tempId,
        email,
        firstName,
        lastName,
        roles: [role as SystemRole],
        isActive: true,
        twoFactorEnabled: false,
        preferences: { theme: 'dark', language: 'es', timezone: 'America/Argentina/Buenos_Aires' },
        tenant: tenant as never,
      });

      await em.flush();
      user.clerkId = user.id;
      await em.flush();

      return reply.status(201).send({
        data: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          roles: user.roles,
        },
        message: `Usuario creado. Asignar contraseña: PATCH /api/settings/users/${user.id}`,
      });
    },
  );

  // ── GET /api/settings/users/:id ─────────────────────────────────────────
  app.get(
    '/:id',
    { preHandler: [requireAuth, requirePermission('user:read')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const em = request.orm.em.fork();

      const user = await em.findOne(User, { id });
      if (!user) {
        return reply.status(404).send({ error: 'Usuario no encontrado' });
      }

      const permissions = listPermissions(user);

      return reply.send({
        data: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          phone: user.phone,
          avatarUrl: user.avatarUrl,
          roles: user.roles,
          groups: user.groups ?? [],
          permissionOverrides: user.permissionOverrides,
          isActive: user.isActive,
          twoFactorEnabled: user.twoFactorEnabled,
          preferences: user.preferences,
          lastLoginAt: user.lastLoginAt,
          createdAt: user.createdAt,
          permissions,
        },
      });
    },
  );

  // ── PATCH /api/settings/users/:id ───────────────────────────────────────
  app.patch(
    '/:id',
    { preHandler: [requireAuth, requirePermission('user:update')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = updateUserSchema.safeParse(request.body);
      if (!result.success) {
        return reply.status(400).send({ error: 'Datos inválidos', details: result.error.flatten() });
      }

      const em = request.orm.em.fork();
      const user = await em.findOne(User, { id });
      if (!user) {
        return reply.status(404).send({ error: 'Usuario no encontrado' });
      }

      if (user.roles.includes(SystemRole.OWNER) && result.data.role) {
        return reply.status(403).send({ error: 'No se puede cambiar el rol del owner.' });
      }

      const { firstName, lastName, phone, role, groups, permissionOverrides, isActive, password } = result.data;

      if (firstName) user.firstName = firstName;
      if (lastName) user.lastName = lastName;
      if (phone !== undefined) user.phone = phone;
      if (role) user.roles = [role as SystemRole];
      if (groups !== undefined) user.groups = groups as SystemGroup[];
      if (permissionOverrides !== undefined) user.permissionOverrides = permissionOverrides as never;
      if (isActive !== undefined) user.isActive = isActive;
      if (password) user.passwordHash = await bcrypt.hash(password, 10);

      await em.flush();

      return reply.send({
        data: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          roles: user.roles,
          groups: user.groups ?? [],
          permissionOverrides: user.permissionOverrides,
          isActive: user.isActive,
        },
      });
    },
  );

  // ── DELETE /api/settings/users/:id (baja lógica) ────────────────────────
  app.delete(
    '/:id',
    { preHandler: [requireAuth, requirePermission('user:delete')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const em = request.orm.em.fork();

      const user = await em.findOne(User, { id });
      if (!user) {
        return reply.status(404).send({ error: 'Usuario no encontrado' });
      }

      if (user.roles.includes(SystemRole.OWNER)) {
        return reply.status(403).send({ error: 'No se puede desactivar al owner.' });
      }

      user.isActive = false;
      await em.flush();

      return reply.status(204).send();
    },
  );
}
