import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { buildTestApp } from './helpers/build-app.js';
import { MOCK_REGISTRY, MOCK_OWNER } from './helpers/mock-orm.js';
import { TenantStatus, SubscriptionStatus, TenantPlan } from '@inmob/shared';
import type { FastifyInstance } from 'fastify';
import type { MockEm } from './helpers/mock-orm.js';

const TENANT_HEADER = { 'x-tenant': 'demo' };

describe('License middleware', () => {
  let app: FastifyInstance;
  let token: string;
  let platformEm: MockEm;

  // Registro mutable — cambiamos la implementación de findOne por test group
  const mutableRegistry = { ...MOCK_REGISTRY };

  beforeAll(async () => {
    const { createMockEm, createTenantEm } = await import('./helpers/mock-orm.js');

    platformEm = createMockEm({
      findOne: vi.fn().mockImplementation(() => Promise.resolve({ ...mutableRegistry })),
      find: vi.fn().mockImplementation(() => Promise.resolve([{ ...mutableRegistry }])),
      findAndCount: vi.fn().mockImplementation(() => Promise.resolve([[{ ...mutableRegistry }], 1])),
      flush: vi.fn().mockResolvedValue(undefined),
    });

    const tenantEm = createTenantEm();

    ({ app } = await buildTestApp({ platformEm, tenantEm }));

    // Obtener token una sola vez
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { ...TENANT_HEADER, 'content-type': 'application/json' },
      body: JSON.stringify({ email: MOCK_OWNER.email, password: 'owner123' }),
    });
    token = loginRes.json().token;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('trial activo (30 días restantes)', () => {
    beforeAll(() => {
      Object.assign(mutableRegistry, {
        ...MOCK_REGISTRY,
        status: TenantStatus.TRIAL,
        subscriptionStatus: SubscriptionStatus.TRIALING,
        trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });
    });

    it('allows access to protected endpoints', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/properties',
        headers: { ...TENANT_HEADER, authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it('returns X-Trial-Days-Left header', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/properties',
        headers: { ...TENANT_HEADER, authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const daysLeft = Number(res.headers['x-trial-days-left']);
      expect(daysLeft).toBeGreaterThan(0);
      expect(daysLeft).toBeLessThanOrEqual(30);
    });
  });

  describe('trial expirado', () => {
    beforeAll(() => {
      Object.assign(mutableRegistry, {
        ...MOCK_REGISTRY,
        status: TenantStatus.TRIAL,
        subscriptionStatus: SubscriptionStatus.TRIALING,
        trialEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // ayer
      });
    });

    it('returns 402 TRIAL_EXPIRED on protected endpoints', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/properties',
        headers: { ...TENANT_HEADER, authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(402);
      expect(res.json().code).toBe('TRIAL_EXPIRED');
    });
  });

  describe('cuenta suspendida (PAST_DUE con X-Billing-Warning)', () => {
    beforeAll(() => {
      Object.assign(mutableRegistry, {
        ...MOCK_REGISTRY,
        status: TenantStatus.ACTIVE,
        subscriptionStatus: SubscriptionStatus.PAST_DUE,
        trialEndsAt: null,
      });
    });

    it('allows access and returns X-Billing-Warning header', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/properties',
        headers: { ...TENANT_HEADER, authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['x-billing-warning']).toBe('payment_failed');
    });
  });

  describe('cuenta suspendida (status SUSPENDED)', () => {
    beforeAll(() => {
      Object.assign(mutableRegistry, {
        ...MOCK_REGISTRY,
        status: TenantStatus.SUSPENDED,
        subscriptionStatus: SubscriptionStatus.EXPIRED,
        trialEndsAt: null,
      });
    });

    it('allows GET requests', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/properties',
        headers: { ...TENANT_HEADER, authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it('blocks POST with 403 ACCOUNT_SUSPENDED', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/properties',
        headers: { ...TENANT_HEADER, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Test',
          type: 'house',
          operationType: 'sale',
          price: 100000,
          currency: 'USD',
          address: { street: 'Test', city: 'BA', state: 'BA', country: 'AR', showExactAddress: false },
          features: { totalArea: 100 },
          amenities: [],
        }),
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('ACCOUNT_SUSPENDED');
    });
  });

  describe('cuenta cancelada', () => {
    beforeAll(() => {
      Object.assign(mutableRegistry, {
        ...MOCK_REGISTRY,
        status: TenantStatus.CANCELLED,
        trialEndsAt: null,
      });
    });

    it('blocks all requests with 403 ACCOUNT_CANCELLED', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/properties',
        headers: { ...TENANT_HEADER, authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('ACCOUNT_CANCELLED');
    });
  });
});
