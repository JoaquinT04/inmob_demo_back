import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permissions.js';
import { Contact } from '@inmob/database';

export async function contactRoutes(app: FastifyInstance) {
  app.get(
    '/',
    { preHandler: [requireAuth, requirePermission('contact:read')] },
    async (request, reply) => {
      const em = request.orm.em.fork();
      const contacts = await em.find(Contact, {});
      return reply.send({ data: contacts });
    },
  );
}
