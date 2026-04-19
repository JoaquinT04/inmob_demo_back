/**
 * /api/properties — pendiente de implementar.
 * Stub para que el router compile. Implementar en sprint siguiente.
 */
import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permissions.js';
import { checkLicense } from '../../middleware/license.js';
import { Property } from '@inmob/database';

export async function propertyRoutes(app: FastifyInstance) {
  app.get(
    '/',
    { preHandler: [requireAuth, checkLicense, requirePermission('property:read')] },
    async (request, reply) => {
      const em = app.orm.em.fork();
      const properties = await em.find(Property, { tenant: { id: request.auth!.tenantId } });
      return reply.send({ data: properties });
    },
  );
}
