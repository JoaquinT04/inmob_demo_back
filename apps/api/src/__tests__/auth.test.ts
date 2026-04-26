import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestApp } from './helpers/build-app.js';
import { createTenantEm, MOCK_OWNER } from './helpers/mock-orm.js';
import type { FastifyInstance } from 'fastify';

const TENANT_HEADER = { 'x-tenant': 'demo', 'content-type': 'application/json' };

describe('POST /api/auth/login', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    ({ app } = await buildTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with token on valid credentials', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: TENANT_HEADER,
      body: JSON.stringify({ email: 'owner@demo.com', password: 'owner123' }),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.token).toBeDefined();
    expect(body.token).toMatch(/^eyJ/); // JWT format
    expect(body.user.email).toBe('owner@demo.com');
    expect(body.user.roles).toContain('owner');
    expect(body.user.permissions).toBeInstanceOf(Array);
    expect(body.user.permissions.length).toBeGreaterThan(0);
    expect(body.tenant.subdomain).toBe('demo');
  });

  it('returns 401 INVALID_CREDENTIALS on wrong password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: TENANT_HEADER,
      body: JSON.stringify({ email: 'owner@demo.com', password: 'wrongpassword' }),
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('INVALID_CREDENTIALS');
  });

  it('returns 401 INVALID_CREDENTIALS on unknown email', async () => {
    const tenantEm = createTenantEm();
    // findOne devuelve null para cualquier email
    tenantEm.findOne.mockResolvedValue(null);
    const { app: isolatedApp } = await buildTestApp({ tenantEm });

    const res = await isolatedApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: TENANT_HEADER,
      body: JSON.stringify({ email: 'noexiste@demo.com', password: 'owner123' }),
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('INVALID_CREDENTIALS');
    await isolatedApp.close();
  });

  it('returns 403 USER_INACTIVE on deactivated user', async () => {
    const inactiveUser = { ...MOCK_OWNER, isActive: false };
    const tenantEm = createTenantEm(inactiveUser);
    const { app: isolatedApp } = await buildTestApp({ tenantEm });

    const res = await isolatedApp.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: TENANT_HEADER,
      body: JSON.stringify({ email: 'owner@demo.com', password: 'owner123' }),
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('USER_INACTIVE');
    await isolatedApp.close();
  });

  it('returns 400 on missing email', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: TENANT_HEADER,
      body: JSON.stringify({ password: 'owner123' }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 on invalid email format', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: TENANT_HEADER,
      body: JSON.stringify({ email: 'not-an-email', password: 'owner123' }),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/auth/me', () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    ({ app } = await buildTestApp());

    // Obtener token via login
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: TENANT_HEADER,
      body: JSON.stringify({ email: 'owner@demo.com', password: 'owner123' }),
    });
    token = loginRes.json().token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with user data on valid token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: {
        'authorization': `Bearer ${token}`,
        'x-tenant': 'demo',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user.email).toBe('owner@demo.com');
    expect(body.permissions).toBeInstanceOf(Array);
  });

  it('returns 401 MISSING_TOKEN without auth header', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { 'x-tenant': 'demo' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('MISSING_TOKEN');
  });

  it('returns 401 on invalid/expired token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: {
        'authorization': 'Bearer eyJhbGciOiJIUzI1NiJ9.invalid.signature',
        'x-tenant': 'demo',
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it('POST /api/auth/logout returns 204', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { 'authorization': `Bearer ${token}`, 'x-tenant': 'demo' },
    });
    expect(res.statusCode).toBe(204);
  });
});
