import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Tenant, User } from '@inmob/database';
import { GroupDefinitions, SystemRole } from '@inmob/shared';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permissions.js';
import { listPermissions } from '../../utils/permissions.js';

const roleOverrideSchema = z.object({
  role: z.enum([
    SystemRole.ADMINISTRADOR,
    SystemRole.COORDINADOR,
    SystemRole.AGENTE,
    SystemRole.CAPTADOR,
  ]),
  grant: z.array(z.string()).default([]),
  deny: z.array(z.string()).default([]),
});

export async function permissionsSettingsRoutes(app: FastifyInstance) {
  app.get(
    '/',
    { preHandler: [requireAuth, requirePermission('settings:read')] },
    async (request, reply) => {
      const em = request.orm.em.fork();
      const tenant = await em.findOne(Tenant, {});

      return reply.send({
        data: {
          permissionConfig: tenant?.permissionConfig ?? null,
          availableGroups: Object.values(GroupDefinitions).map((g) => ({
            id: g.id,
            name: g.name,
            description: g.description,
            permissions: g.permissions,
            impliedGroups: g.impliedGroups ?? [],
          })),
        },
      });
    },
  );

  app.put(
    '/roles',
    { preHandler: [requireAuth, requirePermission('settings:manage')] },
    async (request, reply) => {
      const result = roleOverrideSchema.safeParse(request.body);
      if (!result.success) {
        return reply.status(400).send({ error: 'Datos inválidos', details: result.error.flatten() });
      }

      const { role, grant, deny } = result.data;
      const em = request.orm.em.fork();
      const tenant = await em.findOne(Tenant, {});

      if (!tenant) {
        return reply.status(404).send({ error: 'Tenant no encontrado' });
      }

      tenant.permissionConfig = {
        roleOverrides: {
          ...tenant.permissionConfig?.roleOverrides,
          [role]: { grant: grant as never[], deny: deny as never[] },
        },
      };

      await em.flush();

      return reply.send({
        data: tenant.permissionConfig,
        message: `Permisos del rol "${role}" actualizados.`,
      });
    },
  );

  app.get(
    '/resolve/:userId',
    { preHandler: [requireAuth, requirePermission('settings:manage')] },
    async (request, reply) => {
      const { userId } = request.params as { userId: string };
      const em = request.orm.em.fork();

      const user = await em.findOne(User, { id: userId });
      if (!user) {
        return reply.status(404).send({ error: 'Usuario no encontrado' });
      }

      const tenant = await em.findOne(Tenant, {});
      const permissions = listPermissions(user, tenant?.permissionConfig);

      return reply.send({
        data: {
          userId: user.id,
          email: user.email,
          roles: user.roles,
          groups: user.groups ?? [],
          permissionOverrides: user.permissionOverrides,
          effectivePermissions: permissions,
          totalCount: permissions.length,
        },
      });
    },
  );
}
