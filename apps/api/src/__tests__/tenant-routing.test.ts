import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { buildTestApp } from './helpers/build-app.js';
import type { FastifyInstance } from 'fastify';

describe('Tenant routing hook', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    ({ app } = await buildTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('resolves tenant from X-Tenant header', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-tenant': 'demo', 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'owner@demo.com', password: 'owner123' }),
    });
    // 200 = tenant found + credentials valid
    expect(res.statusCode).toBe(200);
  });

  it('returns 400 TENANT_MISSING when no X-Tenant and no subdomain', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      // No X-Tenant, host=localhost → no subdomain detected
      body: JSON.stringify({ email: 'owner@demo.com', password: 'owner123' }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('TENANT_MISSING');
  });

  it('returns 404 TENANT_NOT_FOUND when subdomain does not exist in platform DB', async () => {
    // Platform EM que nunca encuentra nada (findOne siempre retorna null)
    const { createMockEm } = await import('./helpers/mock-orm.js');
    const emptyPlatformEm = createMockEm({
      findOne: vi.fn().mockResolvedValue(null),
      find: vi.fn().mockResolvedValue([]),
      findAndCount: vi.fn().mockResolvedValue([[], 0]),
    });
    const { app: isolatedApp } = await buildTestApp({ platformEm: emptyPlatformEm });

    const res = await isolatedApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-tenant': 'nonexistent', 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'x@x.com', password: '123' }),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('TENANT_NOT_FOUND');
    await isolatedApp.close();
  });

  it('skips tenant routing for /api/portal endpoints', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/portal/tenants',
      // Sin X-Tenant — debe funcionar igual
    });
    // No 400/404 de tenant routing
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(404);
  });

  it('skips tenant routing for /health', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });
});
