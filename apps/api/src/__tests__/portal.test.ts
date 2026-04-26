import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { buildTestApp } from './helpers/build-app.js';
import { MOCK_REGISTRY } from './helpers/mock-orm.js';
import type { FastifyInstance } from 'fastify';

vi.mock('@inmob/platform', async () => {
  const actual = await vi.importActual('@inmob/platform');
  return {
    ...(actual as object),
    provision: vi.fn().mockResolvedValue({
      subdomain: 'nueva',
      databaseUrl: 'postgresql://mock/nueva',
      ownerId: 'new-user-uuid',
      token: 'eyJ.mock.token',
    }),
  };
});

describe('GET /api/portal/tenants', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    ({ app } = await buildTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns list of active tenants without X-Tenant header', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/portal/tenants' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeInstanceOf(Array);
  });

  it('includes subdomain, name, logoUrl in each tenant', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/portal/tenants' });
    const body = res.json();
    if (body.data.length > 0) {
      const tenant = body.data[0];
      expect(tenant).toHaveProperty('subdomain');
      expect(tenant).toHaveProperty('name');
      expect(tenant).toHaveProperty('logoUrl');
    }
  });
});

describe('GET /api/portal/hub', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    ({ app } = await buildTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns paginated results without authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/portal/hub' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeInstanceOf(Array);
    expect(body.meta).toBeDefined();
    expect(body.meta.page).toBe(1);
    expect(body.meta.perPage).toBe(20);
  });

  it('accepts query filters', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/portal/hub?type=apartment&operationType=sale&city=Buenos Aires',
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('POST /api/portal/provision', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    ({ app } = await buildTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  const VALID_BODY = {
    subdomain: 'nueva',
    name: 'Nueva Inmobiliaria',
    ownerEmail: 'nueva@test.com',
    ownerFirstName: 'Juan',
    ownerLastName: 'García',
    password: 'password123',
    country: 'AR',
  };

  it('returns 201 with token on valid input', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/portal/provision',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_BODY),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.token).toBeDefined();
    expect(body.subdomain).toBe('nueva');
    expect(body.message).toBeDefined();
  });

  it('returns 409 SUBDOMAIN_TAKEN when subdomain already exists', async () => {
    // El mock_registry ya tiene subdomain "demo"
    const res = await app.inject({
      method: 'POST',
      url: '/api/portal/provision',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_BODY, subdomain: 'demo' }),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('SUBDOMAIN_TAKEN');
  });

  it('returns 400 on missing required fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/portal/provision',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subdomain: 'test' }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 on invalid subdomain format (uppercase)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/portal/provision',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_BODY, subdomain: 'Invalid-Subdomain' }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 on subdomain too short', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/portal/provision',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_BODY, subdomain: 'ab' }),
    });
    expect(res.statusCode).toBe(400);
  });
});
