/**
 * /api/properties — CRUD completo de propiedades del tenant.
 *
 * GET    /api/properties             → Listar (con filtros opcionales)
 * POST   /api/properties             → Crear propiedad
 * GET    /api/properties/:id         → Ver detalle
 * PATCH  /api/properties/:id         → Editar
 * DELETE /api/properties/:id         → Archivar (baja lógica → status: archived)
 * PATCH  /api/properties/:id/publish → Publicar / despublicar
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { raw } from '@mikro-orm/postgresql';
import { Property, Tenant, User } from '@inmob/database';
import {
  PropertyType,
  OperationType,
  PropertyStatus,
  Currency,
  slugify,
} from '@inmob/shared';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permissions.js';
import { checkLicense } from '../../middleware/license.js';

// ─── Schemas ──────────────────────────────────────────────────────────────────

const addressSchema = z.object({
  street: z.string().min(1),
  number: z.string().optional(),
  neighborhood: z.string().optional(),
  city: z.string().min(1),
  state: z.string().min(1),
  zipCode: z.string().optional(),
  country: z.string().min(1).default('AR'),
  coordinates: z.object({ lat: z.number(), lng: z.number() }).optional(),
  showExactAddress: z.boolean().default(true),
});

const featuresSchema = z.object({
  totalArea: z.number().positive().optional(),
  coveredArea: z.number().positive().optional(),
  rooms: z.number().int().nonnegative().optional(),
  bedrooms: z.number().int().nonnegative().optional(),
  bathrooms: z.number().int().nonnegative().optional(),
  garages: z.number().int().nonnegative().optional(),
  age: z.number().int().nonnegative().optional(),
}).default({});

const createPropertySchema = z.object({
  title: z.string().min(3).max(200),
  slug: z.string().min(3).max(100).optional(),
  description: z.string().max(5000).optional(),
  type: z.enum([
    PropertyType.HOUSE, PropertyType.APARTMENT, PropertyType.LAND,
    PropertyType.COMMERCIAL, PropertyType.OFFICE, PropertyType.WAREHOUSE,
    PropertyType.GARAGE, PropertyType.OTHER,
  ]),
  operationType: z.enum([
    OperationType.SALE, OperationType.RENT, OperationType.TEMPORARY_RENT,
  ]),
  price: z.number().positive(),
  currency: z.enum([Currency.ARS, Currency.USD, Currency.EUR]),
  expenses: z.number().nonnegative().optional(),
  address: addressSchema,
  features: featuresSchema,
  amenities: z.array(z.string()).default([]),
  assignedUserId: z.string().uuid().optional(),
});

const updatePropertySchema = z.object({
  title: z.string().min(3).max(200).optional(),
  description: z.string().max(5000).optional(),
  type: z.enum([
    PropertyType.HOUSE, PropertyType.APARTMENT, PropertyType.LAND,
    PropertyType.COMMERCIAL, PropertyType.OFFICE, PropertyType.WAREHOUSE,
    PropertyType.GARAGE, PropertyType.OTHER,
  ]).optional(),
  operationType: z.enum([
    OperationType.SALE, OperationType.RENT, OperationType.TEMPORARY_RENT,
  ]).optional(),
  status: z.enum([
    PropertyStatus.DRAFT, PropertyStatus.ACTIVE, PropertyStatus.RESERVED,
    PropertyStatus.SOLD, PropertyStatus.RENTED, PropertyStatus.PAUSED,
    PropertyStatus.ARCHIVED,
  ]).optional(),
  price: z.number().positive().optional(),
  currency: z.enum([Currency.ARS, Currency.USD, Currency.EUR]).optional(),
  expenses: z.number().nonnegative().optional(),
  address: addressSchema.partial().optional(),
  features: featuresSchema.optional(),
  amenities: z.array(z.string()).optional(),
  assignedUserId: z.string().uuid().nullable().optional(),
});

// ─── Helper: generar slug único ───────────────────────────────────────────────

async function uniqueSlug(base: string, em: import('@mikro-orm/postgresql').EntityManager, excludeId?: string): Promise<string> {
  const baseSlug = slugify(base).slice(0, 80);
  let candidate = baseSlug;
  let attempt = 0;

  while (true) {
    const existing = await em.findOne(Property, { slug: candidate });
    if (!existing || existing.id === excludeId) return candidate;
    attempt++;
    candidate = `${baseSlug}-${attempt}`;
  }
}

// ─── Rutas ────────────────────────────────────────────────────────────────────

export async function propertyRoutes(app: FastifyInstance) {

  // ── GET /api/properties ──────────────────────────────────────────────────
  app.get(
    '/',
    { preHandler: [requireAuth, checkLicense, requirePermission('property:read')] },
    async (request, reply) => {
      const {
        status,
        type,
        operationType,
        city,
        neighborhood,
        priceMin,
        priceMax,
        rooms,
        ageMax,
        page = '1',
        perPage = '20',
      } = request.query as Record<string, string>;

      const em = request.orm.em.fork();

      const pageNum = Math.max(1, Number(page));
      const perPageNum = Math.min(100, Math.max(1, Number(perPage)));
      const offset = (pageNum - 1) * perPageNum;

      const qb = em.createQueryBuilder(Property, 'p');

      if (status)        qb.andWhere({ status });
      if (type)          qb.andWhere({ type });
      if (operationType) qb.andWhere({ operationType });

      if (priceMin) qb.andWhere({ price: { $gte: Number(priceMin) } });
      if (priceMax) qb.andWhere({ price: { $lte: Number(priceMax) } });

      if (city)         qb.andWhere(raw(`p.address->>'city' ILIKE ?`, [`%${city}%`]));
      if (neighborhood) qb.andWhere(raw(`p.address->>'neighborhood' ILIKE ?`, [`%${neighborhood}%`]));

      if (rooms) {
        const roomsNum = Number(rooms);
        if (roomsNum >= 5) {
          qb.andWhere(raw(`(p.features->>'rooms')::int >= 5`));
        } else {
          qb.andWhere(raw(`(p.features->>'rooms')::int = ?`, [roomsNum]));
        }
      }
      if (ageMax !== undefined && ageMax !== '') {
        qb.andWhere(raw(`(p.features->>'age')::int <= ?`, [Number(ageMax)]));
      }

      qb.orderBy({ createdAt: 'DESC' }).limit(perPageNum).offset(offset);

      const [properties, total] = await qb.getResultAndCount();

      return reply.send({
        data: properties.map((p) => ({
          id: p.id,
          title: p.title,
          slug: p.slug,
          type: p.type,
          operationType: p.operationType,
          status: p.status,
          price: p.price,
          currency: p.currency,
          address: {
            neighborhood: p.address.neighborhood,
            city: p.address.city,
            state: p.address.state,
            country: p.address.country,
            showExactAddress: p.address.showExactAddress,
          },
          features: p.features,
          images: p.images.slice(0, 1),
          publishedAt: p.publishedAt,
          createdAt: p.createdAt,
        })),
        meta: {
          total,
          page: pageNum,
          perPage: perPageNum,
          totalPages: Math.ceil(total / perPageNum),
          hasNextPage: pageNum * perPageNum < total,
          hasPreviousPage: pageNum > 1,
        },
      });
    },
  );

  // ── POST /api/properties ─────────────────────────────────────────────────
  app.post(
    '/',
    { preHandler: [requireAuth, checkLicense, requirePermission('property:create')] },
    async (request, reply) => {
      const result = createPropertySchema.safeParse(request.body);
      if (!result.success) {
        return reply.status(400).send({ error: 'Datos inválidos', details: result.error.flatten() });
      }

      const em = request.orm.em.fork();

      const {
        title, slug: rawSlug, description, type, operationType,
        price, currency, expenses, address, features, amenities,
        assignedUserId,
      } = result.data;

      const slug = await uniqueSlug(rawSlug ?? title, em);

      let assignedUser: User | null = null;
      if (assignedUserId) {
        assignedUser = await em.findOne(User, { id: assignedUserId });
        if (!assignedUser) {
          return reply.status(404).send({ error: 'Usuario asignado no encontrado' });
        }
      }

      const tenant = await em.findOne(Tenant, {});

      const property = em.create(Property, {
        title,
        slug,
        description,
        type,
        operationType,
        status: PropertyStatus.DRAFT,
        price,
        currency,
        expenses,
        address,
        features: features ?? {},
        amenities: amenities ?? [],
        images: [],
        tenant: tenant as never,
        assignedUser: assignedUser ?? undefined,
      } as never);

      await em.flush();

      return reply.status(201).send({ data: propertyDetail(property) });
    },
  );

  // ── GET /api/properties/:id ──────────────────────────────────────────────
  app.get(
    '/:id',
    { preHandler: [requireAuth, checkLicense, requirePermission('property:read')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const em = request.orm.em.fork();

      const property = await em.findOne(Property, { id }, { populate: ['assignedUser'] });

      if (!property) {
        return reply.status(404).send({ error: 'Propiedad no encontrada' });
      }

      return reply.send({ data: propertyDetail(property) });
    },
  );

  // ── PATCH /api/properties/:id ────────────────────────────────────────────
  app.patch(
    '/:id',
    { preHandler: [requireAuth, checkLicense, requirePermission('property:update')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = updatePropertySchema.safeParse(request.body);
      if (!result.success) {
        return reply.status(400).send({ error: 'Datos inválidos', details: result.error.flatten() });
      }

      const em = request.orm.em.fork();
      const property = await em.findOne(Property, { id });

      if (!property) {
        return reply.status(404).send({ error: 'Propiedad no encontrada' });
      }

      if (property.status === PropertyStatus.ARCHIVED) {
        return reply.status(400).send({ error: 'Propiedad archivada, no se puede editar.' });
      }

      const {
        title, description, type, operationType, status,
        price, currency, expenses, address, features, amenities,
        assignedUserId,
      } = result.data;

      if (title !== undefined) property.title = title;
      if (description !== undefined) property.description = description;
      if (type !== undefined) property.type = type;
      if (operationType !== undefined) property.operationType = operationType;
      if (status !== undefined) property.status = status;
      if (price !== undefined) property.price = price;
      if (currency !== undefined) property.currency = currency;
      if (expenses !== undefined) property.expenses = expenses;
      if (address !== undefined) property.address = { ...property.address, ...address };
      if (features !== undefined) property.features = { ...property.features, ...features };
      if (amenities !== undefined) property.amenities = amenities;

      if (assignedUserId !== undefined) {
        if (assignedUserId === null) {
          property.assignedUser = undefined;
        } else {
          const user = await em.findOne(User, { id: assignedUserId });
          if (!user) return reply.status(404).send({ error: 'Usuario asignado no encontrado' });
          property.assignedUser = user as never;
        }
      }

      await em.flush();

      return reply.send({ data: propertyDetail(property) });
    },
  );

  // ── PATCH /api/properties/:id/publish ────────────────────────────────────
  app.patch(
    '/:id/publish',
    { preHandler: [requireAuth, checkLicense, requirePermission('property:publish')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { publish = true } = request.body as { publish?: boolean };

      const em = request.orm.em.fork();
      const property = await em.findOne(Property, { id });

      if (!property) {
        return reply.status(404).send({ error: 'Propiedad no encontrada' });
      }

      if (publish) {
        property.status = PropertyStatus.ACTIVE;
        property.publishedAt = property.publishedAt ?? new Date();
      } else {
        property.status = PropertyStatus.PAUSED;
      }

      await em.flush();

      return reply.send({
        data: { id: property.id, status: property.status, publishedAt: property.publishedAt },
        message: publish ? 'Propiedad publicada.' : 'Propiedad pausada.',
      });
    },
  );

  // ── DELETE /api/properties/:id ───────────────────────────────────────────
  app.delete(
    '/:id',
    { preHandler: [requireAuth, checkLicense, requirePermission('property:delete')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const em = request.orm.em.fork();

      const property = await em.findOne(Property, { id });

      if (!property) {
        return reply.status(404).send({ error: 'Propiedad no encontrada' });
      }

      property.status = PropertyStatus.ARCHIVED;
      await em.flush();

      return reply.status(204).send();
    },
  );
}

// ─── Serialización detalle ────────────────────────────────────────────────────

function propertyDetail(p: Property) {
  return {
    id: p.id,
    title: p.title,
    slug: p.slug,
    description: p.description ?? null,
    type: p.type,
    operationType: p.operationType,
    status: p.status,
    price: p.price,
    currency: p.currency,
    expenses: p.expenses ?? null,
    address: p.address,
    features: p.features,
    amenities: p.amenities,
    images: p.images,
    publishedAt: p.publishedAt ?? null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}
