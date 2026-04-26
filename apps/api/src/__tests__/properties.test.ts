import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestApp } from './helpers/build-app.js';
import type { FastifyInstance } from 'fastify';

const TENANT_HEADER = { 'x-tenant': 'demo' };

const VALID_PROPERTY = {
  title: 'Casa en Palermo',
  type: 'house',
  operationType: 'sale',
  price: 180000,
  currency: 'USD',
  address: {
    street: 'Thames',
    number: '1234',
    neighborhood: 'Palermo',
    city: 'Buenos Aires',
    state: 'Buenos Aires',
    country: 'AR',
    showExactAddress: true,
  },
  features: {
    totalArea: 200,
    coveredArea: 150,
    rooms: 5,
    bedrooms: 3,
    bathrooms: 2,
  },
  amenities: ['pileta'],
};

describe('Properties endpoints', () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    ({ app } = await buildTestApp());
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { ...TENANT_HEADER, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'owner@demo.com', password: 'owner123' }),
    });
    token = loginRes.json().token;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/properties', () => {
    it('returns 200 with paginated results', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/properties',
        headers: { ...TENANT_HEADER, authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toBeInstanceOf(Array);
      expect(body.meta).toBeDefined();
      expect(body.meta.page).toBe(1);
    });

    it('returns 401 without token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/properties',
        headers: TENANT_HEADER,
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 400 without X-Tenant', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/properties',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('TENANT_MISSING');
    });

    it('accepts filter params without errors', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/properties?type=apartment&operationType=sale&city=Buenos+Aires&page=1&perPage=10',
        headers: { ...TENANT_HEADER, authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it('returns 200 with correct meta structure', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/properties',
        headers: { ...TENANT_HEADER, authorization: `Bearer ${token}` },
      });
      const { meta } = res.json();
      expect(meta).toHaveProperty('total');
      expect(meta).toHaveProperty('page');
      expect(meta).toHaveProperty('perPage');
      expect(meta).toHaveProperty('totalPages');
      expect(meta).toHaveProperty('hasNextPage');
      expect(meta).toHaveProperty('hasPreviousPage');
    });
  });

  describe('POST /api/properties', () => {
    it('returns 201 on valid property creation', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/properties',
        headers: { ...TENANT_HEADER, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(VALID_PROPERTY),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.data).toBeDefined();
      expect(body.data.title).toBe('Casa en Palermo');
      expect(body.data.status).toBe('draft');
    });

    it('returns 400 on missing required fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/properties',
        headers: { ...TENANT_HEADER, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Solo título' }),
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 401 without token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/properties',
        headers: { ...TENANT_HEADER, 'content-type': 'application/json' },
        body: JSON.stringify(VALID_PROPERTY),
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /api/properties/:id', () => {
    it('returns 404 when property does not exist', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/properties/nonexistent-uuid',
        headers: { ...TENANT_HEADER, authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
