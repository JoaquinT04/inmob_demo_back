import type { FastifyInstance } from 'fastify';
import { TenantRegistry } from '@inmob/platform';
import { connectionManager } from '../lib/connection-manager.js';

/**
 * Resuelve el tenant de cada request en este orden de prioridad:
 *
 * 1. Header X-Tenant: demo         ← dev local / frontend sin subdominio real
 * 2. Subdominio del host: demo.inmob.com
 *
 * El header tiene prioridad para facilitar desarrollo frontend sin DNS.
 * En producción se puede ignorar el header desactivando NODE_ENV=development,
 * o simplemente confiar en que el host siempre llega con subdominio real.
 */
export function registerTenantRoutingHook(app: FastifyInstance): void {
  app.addHook('onRequest', async (request, reply) => {
    // Portal endpoints usan platform DB directamente — no necesitan tenant routing
    if (request.url.startsWith('/api/portal')) return;
    if (request.url.startsWith('/api/register')) return;
    if (request.url.startsWith('/health')) return;

    // 1. Header X-Tenant (dev + frontend sin wildcard DNS)
    const headerTenant = request.headers['x-tenant'] as string | undefined;

    // 2. Subdominio del hostname — solo si el host es un subdominio real del APP_DOMAIN
    const appDomain = process.env['APP_DOMAIN'] ?? '';
    const host = request.hostname;
    const hostSubdomain = (appDomain && host.endsWith(`.${appDomain}`))
      ? host.slice(0, host.length - appDomain.length - 1)
      : null;

    const subdomain = headerTenant ?? hostSubdomain;

    if (!subdomain) {
      reply.code(400).send({
        error: 'Tenant no identificado. Enviá el header X-Tenant: <subdomain> o usá un subdominio.',
        code: 'TENANT_MISSING',
      });
      return;
    }

    const platformEm = app.platformOrm.em.fork();
    const registry = await platformEm.findOne(TenantRegistry, { subdomain });

    if (!registry) {
      reply.code(404).send({ error: `Tenant '${subdomain}' no encontrado.`, code: 'TENANT_NOT_FOUND' });
      return;
    }

    request.tenantSubdomain = subdomain;
    request.orm = await connectionManager.get(registry.databaseUrl);
  });
}
