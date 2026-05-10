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
import { portalRoutes } from './routes/portal/index.js';
import { googleOAuthRoutes } from './routes/auth-google.js';
import { registerTenantRoutingHook } from './hooks/tenant-routing.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Platform-level ORM (TenantRegistry, HubProperty, billing) */
    platformOrm: MikroORM;
    /** @deprecated use request.orm — kept for legacy init path */
    orm: MikroORM;
  }
  interface FastifyRequest {
    /** Tenant-specific ORM resolved from subdomain routing */
    orm: MikroORM;
    tenantSubdomain: string;
  }
}

export async function buildApp({ orm, platformOrm }: { orm: MikroORM; platformOrm: MikroORM }) {
  const app = Fastify({
    logger: {
      level: process.env['NODE_ENV'] === 'development' ? 'debug' : 'info',
      transport: process.env['NODE_ENV'] === 'development'
        ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
        : undefined,
    },
  });

  // ── Decorar instancia ────────────────────────────────────────────────────
  app.decorate('orm', orm);
  app.decorate('platformOrm', platformOrm);
  app.decorateRequest('orm', null as never);
  app.decorateRequest('tenantSubdomain', '');

  // ── MikroORM: contexto por request ───────────────────────────────────────
  app.addHook('onRequest', (_req, _res, done) => {
    RequestContext.create(platformOrm.em, done);
  });

  // ── Subdomain → tenant ORM routing ──────────────────────────────────────
  registerTenantRoutingHook(app);

  // ── Plugins de seguridad ─────────────────────────────────────────────────
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
  });

  const corsOrigin = process.env['CORS_ORIGIN'];
  if (!corsOrigin && process.env['NODE_ENV'] === 'production') {
    throw new Error('CORS_ORIGIN env var is required in production');
  }
  await app.register(cors, {
    origin: corsOrigin?.split(',') ?? false,
    credentials: true,
  });

  // ── Rutas ────────────────────────────────────────────────────────────────
  await app.register(healthRoutes, { prefix: '/health' });
  await app.register(registerRoutes, { prefix: '/api/register' });
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(googleOAuthRoutes, { prefix: '/api/auth' });
  await app.register(tenantRoutes, { prefix: '/api/tenants' });
  await app.register(subscriptionRoutes, { prefix: '/api/subscriptions' });
  await app.register(propertyRoutes, { prefix: '/api/properties' });
  await app.register(contactRoutes, { prefix: '/api/contacts' });
  await app.register(crmRoutes, { prefix: '/api/crm' });
  await app.register(agendaRoutes, { prefix: '/api/agenda' });
  await app.register(settingsRoutes, { prefix: '/api/settings' });
  await app.register(portalRoutes, { prefix: '/api/portal' });

  // ── Error handler global ─────────────────────────────────────────────────
  app.setErrorHandler((error: Error & { statusCode?: number }, req, reply) => {
    app.log.error({ err: error, url: req.url }, 'Unhandled error');
    const isProd = process.env['NODE_ENV'] === 'production';
    reply.status(error.statusCode ?? 500).send({
      error: isProd ? 'Error interno del servidor' : (error.message ?? 'Error interno'),
      code: 'INTERNAL_ERROR',
    });
  });

  return app;
}
