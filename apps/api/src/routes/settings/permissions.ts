/**
 * Configuración de permisos del tenant (capa 3 del sistema de 5 capas).
 *
 * GET  /api/settings/permissions          → Config actual + catálogo de grupos
 * PUT  /api/settings/permissions/roles    → Override de permisos por rol
 * GET  /api/settings/permissions/resolve/:userId → Permisos efectivos de un usuario
 */
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
  // ── GET /api/settings/permissions ───────────────────────────────────────
  // Devuelve la config actual + el catálogo completo de grupos disponibles.
  app.get(
    '/',
    { preHandler: [requireAuth, requirePermission('settings:read')] },
    async (request, reply) => {
      const em = app.orm.em.fork();
      const tenant = await em.findOne(Tenant, { id: request.auth!.tenantId });

      return reply.send({
        data: {
          // Config actual del tenant (null = sin overrides, usa defaults)
          permissionConfig: tenant?.permissionConfig ?? null,
          // Catálogo completo de grupos del sistema
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

  // ── PUT /api/settings/permissions/roles ──────────────────────────────────
  // El admin configura qué permisos extra tiene o pierde cada rol en su tenant.
  // Solo aplica a roles no-owner (el owner siempre tiene acceso total).
  app.put(
    '/roles',
    { preHandler: [requireAuth, requirePermission('settings:manage')] },
    async (request, reply) => {
      const result = roleOverrideSchema.safeParse(request.body);
      if (!result.success) {
        return reply.status(400).send({ error: 'Datos inválidos', details: result.error.flatten() });
      }

      const { role, grant, deny } = result.data;
      const em = app.orm.em.fork();
      const tenant = await em.findOne(Tenant, { id: request.auth!.tenantId });

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

  // ── GET /api/settings/permissions/resolve/:userId ────────────────────────
  // Vista de diagnóstico: muestra los permisos efectivos de un usuario
  // con detalle de qué capa aportó cada permiso.
  app.get(
    '/resolve/:userId',
    { preHandler: [requireAuth, requirePermission('settings:manage')] },
    async (request, reply) => {
      const { userId } = request.params as { userId: string };
      const em = app.orm.em.fork();

      const user = await em.findOne(User, { id: userId, tenant: { id: request.auth!.tenantId } });
      if (!user) {
        return reply.status(404).send({ error: 'Usuario no encontrado' });
      }

      const tenant = await em.findOne(Tenant, { id: request.auth!.tenantId });
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
