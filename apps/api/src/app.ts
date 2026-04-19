import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import type { MikroORM } from '@mikro-orm/postgresql';
import { RequestContext } from '@mikro-orm/core';

import { healthRoutes } from './routes/health.js';
import { registerRoutes } from './routes/register.js';
import { authRoutes } from './routes/auth.js';
import { tenantRoutes } from './routes/tenants.js';
import { subscriptionRoutes } from './routes/subscriptions.js';
import { propertyRoutes } from './routes/properties/index.js';
import { contactRoutes } from './routes/contacts/index.js';
import { crmRoutes } from './routes/crm/index.js';
import { agendaRoutes } from './routes/agenda/index.js';
import { settingsRoutes } from './routes/settings/index.js';

declare module 'fastify' {
  interface FastifyInstance {
    orm: MikroORM;
  }
}

export async function buildApp({ orm }: { orm: MikroORM }) {
  const app = Fastify({
    logger: {
      level: process.env['NODE_ENV'] === 'development' ? 'debug' : 'info',
      transport: process.env['NODE_ENV'] === 'development'
        ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
        : undefined,
    },
  });

  // ── Decorar instancia con ORM ────────────────────────────────────────────
  app.decorate('orm', orm);

  // ── MikroORM: contexto por request (evita leaks de identity map) ─────────
  app.addHook('onRequest', (_req, _res, done) => {
    RequestContext.create(orm.em, done);
  });

  // ── Plugins de seguridad ─────────────────────────────────────────────────
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: process.env['CORS_ORIGIN']?.split(',') ?? true,
    credentials: true,
  });

  // ── Rutas ────────────────────────────────────────────────────────────────
  await app.register(healthRoutes, { prefix: '/health' });
  await app.register(registerRoutes, { prefix: '/api/register' });
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(tenantRoutes, { prefix: '/api/tenants' });
  await app.register(subscriptionRoutes, { prefix: '/api/subscriptions' });
  await app.register(propertyRoutes, { prefix: '/api/properties' });
  await app.register(contactRoutes, { prefix: '/api/contacts' });
  await app.register(crmRoutes, { prefix: '/api/crm' });
  await app.register(agendaRoutes, { prefix: '/api/agenda' });
  await app.register(settingsRoutes, { prefix: '/api/settings' });

  // ── Error handler global ─────────────────────────────────────────────────
  app.setErrorHandler((error: Error & { statusCode?: number }, _req, reply) => {
    app.log.error(error);
    reply.status((error as { statusCode?: number }).statusCode ?? 500).send({
      error: error.message ?? 'Error interno',
      code: 'INTERNAL_ERROR',
    });
  });

  return app;
}
