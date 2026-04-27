/**
 * /api/portal — Endpoints del portal central (sin tenant routing).
 *
 * POST /api/portal/provision  → Crear nueva inmobiliaria (provisioning Neon + registro platform)
 * GET  /api/portal/hub        → Buscar propiedades publicadas en todos los tenants
 * GET  /api/portal/tenants    → Listar tenants activos (para selector de login)
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { provision } from '@inmob/platform';
import { TenantRegistry, HubProperty } from '@inmob/platform';
import { TenantStatus } from '@inmob/shared';

const provisionSchema = z.object({
  subdomain: z.string().min(3).max(50).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().min(2).max(100),
  ownerEmail: z.string().email(),
  ownerFirstName: z.string().min(1).max(80),
  ownerLastName: z.string().min(1).max(80),
  password: z.string().min(6),
  taxId: z.string().max(20).optional(),
  country: z.string().length(2).default('AR'),
  timezone: z.string().default('America/Argentina/Buenos_Aires'),
});

export async function portalRoutes(app: FastifyInstance) {
  // ── POST /api/portal/provision ───────────────────────────────────────────
  app.post('/provision', async (request, reply) => {
    const result = provisionSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Datos inválidos', details: result.error.flatten() });
    }

    const platformEm = app.platformOrm.em.fork();
    const existing = await platformEm.findOne(TenantRegistry, { subdomain: result.data.subdomain });
    if (existing) {
      return reply.status(409).send({ error: `El subdominio "${result.data.subdomain}" ya está en uso.`, code: 'SUBDOMAIN_TAKEN' });
    }

    try {
      const { token, subdomain } = await provision(result.data, app.platformOrm);
      return reply.status(201).send({
        token,
        subdomain,
        loginUrl: `https://${subdomain}.${process.env['APP_DOMAIN'] ?? 'inmob.local'}`,
        message: `Inmobiliaria "${result.data.name}" creada. Trial de 30 días activo.`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      app.log.error({ err, msg }, 'Provisioning failed');
      return reply.status(500).send({
        error: 'Error al crear la inmobiliaria. Intente de nuevo.',
        code: 'PROVISION_ERROR',
        detail: msg,
      });
    }
  });

  // ── GET /api/portal/neon-check ──────────────────────────────────────────
  app.get('/neon-check', async (_request, reply) => {
    const vars = {
      NEON_API_KEY: process.env['NEON_API_KEY'] ? `set (${process.env['NEON_API_KEY'].slice(0, 8)}...)` : 'MISSING',
      NEON_PROJECT_ID: process.env['NEON_PROJECT_ID'] ?? 'MISSING',
      NEON_BRANCH_ID: process.env['NEON_BRANCH_ID'] ?? 'MISSING',
      NEON_DB_HOST: (() => {
        const h = process.env['NEON_DB_HOST'] ?? '';
        if (!h) return 'MISSING';
        const clean = h.replace(/\s+/g, '');
        const valid = clean.startsWith('postgresql://') || clean.startsWith('postgres://');
        return `${valid ? 'OK' : 'INVALID'} — starts with: "${h.slice(0, 25).replace(/\n/g, '\\n')}"`;
      })(),
      NEON_DB_OWNER: process.env['NEON_DB_OWNER'] ?? 'neondb_owner (default)',
      PLATFORM_DATABASE_URL: process.env['PLATFORM_DATABASE_URL'] ? `set (${process.env['PLATFORM_DATABASE_URL'].slice(0, 30)}...)` : 'MISSING',
    };
    return reply.send({ neonConfig: vars });
  });

  // ── GET /api/portal/hub ──────────────────────────────────────────────────
  app.get('/hub', async (request, reply) => {
    const {
      type, operationType, city, priceMin, priceMax, rooms, page = '1', perPage = '20',
    } = request.query as Record<string, string>;

    const platformEm = app.platformOrm.em.fork();
    const pageNum = Math.max(1, Number(page));
    const perPageNum = Math.min(100, Math.max(1, Number(perPage)));

    const where: Record<string, unknown> = {};
    if (type)          where['type'] = type;
    if (operationType) where['operationType'] = operationType;
    if (city)          where['city'] = { $ilike: `%${city}%` };
    if (priceMin)      where['price'] = { ...(where['price'] as object ?? {}), $gte: Number(priceMin) };
    if (priceMax)      where['price'] = { ...(where['price'] as object ?? {}), $lte: Number(priceMax) };
    if (rooms)         where['rooms'] = Number(rooms);

    const [properties, total] = await platformEm.findAndCount(
      HubProperty,
      where,
      { orderBy: { publishedAt: 'DESC' }, limit: perPageNum, offset: (pageNum - 1) * perPageNum },
    );

    return reply.send({
      data: properties,
      meta: {
        total,
        page: pageNum,
        perPage: perPageNum,
        totalPages: Math.ceil(total / perPageNum),
      },
    });
  });

  // ── GET /api/portal/tenants ──────────────────────────────────────────────
  app.get('/tenants', async (_request, reply) => {
    const platformEm = app.platformOrm.em.fork();
    const tenants = await platformEm.find(
      TenantRegistry,
      { status: TenantStatus.ACTIVE },
      { orderBy: { name: 'ASC' } },
    );

    return reply.send({
      data: tenants.map((t) => ({
        subdomain: t.subdomain,
        name: t.name,
        logoUrl: t.logoUrl ?? null,
      })),
    });
  });
}
