/**
 * POST /api/register
 *
 * Alias público de /api/portal/provision para compatibilidad con el frontend actual.
 * En la arquitectura multi-tenant DB-per-tenant, el registro real provee una nueva
 * base de datos Neon para el tenant. Ver routes/portal/index.ts.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { provision } from '@inmob/platform';
import { TenantRegistry } from '@inmob/platform';
import { slugify } from '@inmob/shared';

const registerSchema = z.object({
  agencyName: z.string().min(2).max(100),
  subdomain: z.string().min(3).max(50).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  ownerEmail: z.string().email(),
  ownerFirstName: z.string().min(1).max(80),
  ownerLastName: z.string().min(1).max(80),
  ownerPhone: z.string().max(30).optional(),
  taxId: z.string().max(20).optional(),
  country: z.string().length(2).default('AR'),
  timezone: z.string().default('America/Argentina/Buenos_Aires'),
  password: z.string().min(6),
});

export async function registerRoutes(app: FastifyInstance) {
  app.post('/', async (request, reply) => {
    const result = registerSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Datos inválidos', details: result.error.flatten().fieldErrors });
    }

    const { agencyName, subdomain: rawSubdomain, ownerEmail, ownerFirstName, ownerLastName, ownerPhone, taxId, country, timezone, password } = result.data;
    const subdomain = rawSubdomain ?? slugify(agencyName).slice(0, 50);

    const platformEm = app.platformOrm.em.fork();
    const existing = await platformEm.findOne(TenantRegistry, { subdomain });
    if (existing) {
      return reply.status(409).send({ error: `El subdominio "${subdomain}" ya está en uso.`, code: 'SUBDOMAIN_TAKEN' });
    }

    try {
      const { token } = await provision(
        { subdomain, name: agencyName, ownerEmail, ownerFirstName, ownerLastName, password, taxId, country, timezone },
        app.platformOrm,
      );

      return reply.status(201).send({
        token,
        subdomain,
        loginUrl: `https://${subdomain}.${process.env['APP_DOMAIN'] ?? 'inmob.local'}`,
        message: `Inmobiliaria "${agencyName}" creada. Trial de 30 días activo.`,
      });
    } catch (err) {
      app.log.error(err, 'Registration failed');
      return reply.status(500).send({ error: 'Error al crear la cuenta. Intente de nuevo.', code: 'PROVISION_ERROR' });
    }
  });

  app.get('/check-slug/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length < 3 || slug.length > 50) {
      return reply.status(400).send({ available: false, error: 'Slug inválido (3-50 chars, minúsculas/números/guiones).' });
    }

    const platformEm = app.platformOrm.em.fork();
    const existing = await platformEm.findOne(TenantRegistry, { subdomain: slug });

    return { available: !existing, slug };
  });
}
