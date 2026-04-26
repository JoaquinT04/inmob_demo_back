import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permissions.js';
import { Agenda } from '@inmob/database';

export async function agendaRoutes(app: FastifyInstance) {
  app.get(
    '/',
    { preHandler: [requireAuth, requirePermission('agenda:read')] },
    async (request, reply) => {
      const em = request.orm.em.fork();
      const events = await em.find(Agenda, {});
      return reply.send({ data: events });
    },
  );
}
