import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permissions.js';
import { Lead } from '@inmob/database';

export async function crmRoutes(app: FastifyInstance) {
  app.get(
    '/leads',
    { preHandler: [requireAuth, requirePermission('crm:read')] },
    async (request, reply) => {
      const em = request.orm.em.fork();
      const leads = await em.find(Lead, {});
      return reply.send({ data: leads });
    },
  );
}
