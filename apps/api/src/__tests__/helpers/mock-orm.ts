import { vi } from 'vitest';
import bcrypt from 'bcryptjs';
import { TenantPlan, TenantStatus, SubscriptionStatus } from '@inmob/shared';

// ── Tenant (única fila en la DB del tenant) ────────────────────────────────
export const MOCK_TENANT = {
  id: 'tenant-uuid-demo',
  name: 'Inmobiliaria Demo',
  slug: 'demo',
  plan: TenantPlan.FREE,
  status: TenantStatus.TRIAL,
  permissionConfig: null,
  logoUrl: null,
};

// ── TenantRegistry (Platform DB) ──────────────────────────────────────────
export const MOCK_REGISTRY = {
  id: 'registry-uuid-demo',
  subdomain: 'demo',
  name: 'Inmobiliaria Demo',
  ownerEmail: 'owner@demo.com',
  databaseUrl: 'postgresql://mock/demo',
  plan: TenantPlan.FREE,
  status: TenantStatus.TRIAL,
  subscriptionStatus: SubscriptionStatus.TRIALING,
  trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 días desde hoy
  cancelAtPeriodEnd: false,
};

// ── Owner user ─────────────────────────────────────────────────────────────
const PASSWORD_HASH = bcrypt.hashSync('owner123', 1); // rounds=1 para speed en tests

export const MOCK_OWNER = {
  id: 'user-uuid-owner',
  email: 'owner@demo.com',
  firstName: 'Owner',
  lastName: 'Demo',
  passwordHash: PASSWORD_HASH,
  roles: ['owner'],
  groups: [],
  permissionOverrides: null,
  isActive: true,
  avatarUrl: null,
  lastLoginAt: null,
  clerkId: 'user-uuid-owner',
  preferences: { theme: 'dark', language: 'es', timezone: 'America/Argentina/Buenos_Aires' },
  twoFactorEnabled: false,
};

// ── Mock EM factory ────────────────────────────────────────────────────────

export type MockEm = {
  fork: () => MockEm;
  findOne: ReturnType<typeof vi.fn>;
  find: ReturnType<typeof vi.fn>;
  findAndCount: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  flush: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
  begin: ReturnType<typeof vi.fn>;
  commit: ReturnType<typeof vi.fn>;
  rollback: ReturnType<typeof vi.fn>;
  persist: ReturnType<typeof vi.fn>;
  createQueryBuilder: ReturnType<typeof vi.fn>;
};

export function createMockEm(overrides: Partial<MockEm> = {}): MockEm {
  const em: MockEm = {
    fork: () => em,
    findOne: vi.fn().mockResolvedValue(null),
    find: vi.fn().mockResolvedValue([]),
    findAndCount: vi.fn().mockResolvedValue([[], 0]),
    create: vi.fn((_, data) => ({ ...data })),
    flush: vi.fn().mockResolvedValue(undefined),
    count: vi.fn().mockResolvedValue(0),
    begin: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    persist: vi.fn().mockReturnThis(),
    createQueryBuilder: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockReturnThis(),
      getResultList: vi.fn().mockResolvedValue([]),
      getCount: vi.fn().mockResolvedValue(0),
      getResultAndCount: vi.fn().mockResolvedValue([[], 0]),
    }),
    ...overrides,
  };
  return em;
}

export type MockOrm = { em: MockEm; close: () => Promise<void> };

export function createMockOrm(em: MockEm): MockOrm {
  return {
    em,
    close: vi.fn().mockResolvedValue(undefined) as () => Promise<void>,
  };
}

// ── Platform EM — responde a TenantRegistry queries ───────────────────────
export function createPlatformEm(registry = MOCK_REGISTRY): MockEm {
  return createMockEm({
    findOne: vi.fn().mockImplementation((_entity, where) => {
      const sub = where?.subdomain;
      if (sub === registry.subdomain) return Promise.resolve(registry);
      return Promise.resolve(null);
    }),
    find: vi.fn().mockImplementation(() => Promise.resolve([registry])),
    findAndCount: vi.fn().mockImplementation(() => Promise.resolve([[registry], 1])),
  });
}

// ── Tenant EM — responde a User/Tenant queries ────────────────────────────
export function createTenantEm(user = MOCK_OWNER, tenant = MOCK_TENANT): MockEm {
  return createMockEm({
    findOne: vi.fn().mockImplementation((_entity, where) => {
      const email = where?.email;
      if (email === user.email) return Promise.resolve(user);
      // findOne(Tenant, {}) → retorna el single Tenant (must have no discriminating fields)
      if (!email && !where?.id && !where?.slug && !where?.subdomain) return Promise.resolve(tenant);
      if (where?.id === user.id) return Promise.resolve(user);
      return Promise.resolve(null);
    }),
    find: vi.fn().mockResolvedValue([user]),
    count: vi.fn().mockResolvedValue(0),
  });
}
