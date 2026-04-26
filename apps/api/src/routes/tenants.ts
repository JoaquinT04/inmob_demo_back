/**
 * GET  /api/tenants/me           → Datos del tenant del usuario autenticado
 * PUT  /api/tenants/me           → Actualizar datos de la inmobiliaria
 * GET  /api/tenants/branding/:subdomain → Branding público (sin auth, para pantalla de login)
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Tenant } from '@inmob/database';
import { TenantRegistry } from '@inmob/platform';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';

const updateTenantSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  legalName: z.string().max(150).optional(),
  taxId: z.string().max(20).optional(),
  address: z.object({
    street: z.string().optional(),
    number: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zipCode: z.string().optional(),
    country: z.string().optional(),
  }).optional(),
  settings: z.object({
    contact: z.object({
      email: z.string().email().optional(),
      phone: z.string().optional(),
      whatsapp: z.string().optional(),
    }).optional(),
    social: z.object({
      website: z.string().url().optional(),
      facebook: z.string().optional(),
      instagram: z.string().optional(),
    }).optional(),
  }).optional(),
});

export async function tenantRoutes(app: FastifyInstance) {
  app.get('/me', { preHandler: requireAuth }, async (request, reply) => {
    const em = request.orm.em.fork();
    const tenant = await em.findOne(Tenant, {});

    if (!tenant) {
      return reply.status(404).send({ error: 'Tenant no encontrado' });
    }

    return reply.send({ data: tenant });
  });

  app.put(
    '/me',
    { preHandler: [requireAuth, requirePermission('settings:update')] },
    async (request, reply) => {
      const result = updateTenantSchema.safeParse(request.body);
      if (!result.success) {
        return reply.status(400).send({ error: 'Datos inválidos', details: result.error.flatten() });
      }

      const em = request.orm.em.fork();
      const tenant = await em.findOne(Tenant, {});

      if (!tenant) {
        return reply.status(404).send({ error: 'Tenant no encontrado' });
      }

      const { name, legalName, taxId, address, settings } = result.data;
      if (name) tenant.name = name;
      if (legalName !== undefined) tenant.legalName = legalName;
      if (taxId !== undefined) tenant.taxId = taxId;
      if (address) tenant.address = { ...tenant.address, ...address };
      if (settings) tenant.settings = { ...tenant.settings, ...settings };

      await em.flush();
      return reply.send({ data: tenant });
    },
  );

  // Public branding endpoint — uses platform registry for basic info
  app.get('/branding/:subdomain', async (request, reply) => {
    const { subdomain } = request.params as { subdomain: string };
    const platformEm = app.platformOrm.em.fork();
    const registry = await platformEm.findOne(TenantRegistry, { subdomain });

    if (!registry) {
      return reply.status(404).send({ error: 'Inmobiliaria no encontrada' });
    }

    return reply.send({
      data: {
        subdomain: registry.subdomain,
        name: registry.name,
        logoUrl: registry.logoUrl ?? null,
      },
    });
  });
}
