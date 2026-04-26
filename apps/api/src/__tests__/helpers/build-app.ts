import { vi } from 'vitest';
import { buildApp } from '../../app.js';
import {
  createMockOrm,
  createPlatformEm,
  createTenantEm,
  type MockEm,
} from './mock-orm.js';

vi.mock('@mikro-orm/core', async () => {
  const actual = await vi.importActual('@mikro-orm/core');
  return {
    ...(actual as object),
    RequestContext: {
      create: (_em: unknown, done: () => void) => done(),
    },
  };
});

vi.mock('../../lib/connection-manager.js', () => ({
  connectionManager: {
    get: vi.fn(),
    closeAll: vi.fn().mockResolvedValue(undefined),
  },
}));

export async function buildTestApp(opts: {
  platformEm?: MockEm;
  tenantEm?: MockEm;
} = {}) {
  const { connectionManager } = await import('../../lib/connection-manager.js');

  const tenantEm = opts.tenantEm ?? createTenantEm();
  const platformEm = opts.platformEm ?? createPlatformEm();

  const tenantOrm = createMockOrm(tenantEm);
  const platformOrm = createMockOrm(platformEm);

  (connectionManager.get as ReturnType<typeof vi.fn>).mockResolvedValue(tenantOrm);

  const app = await buildApp({
    orm: tenantOrm as never,
    platformOrm: platformOrm as never,
  });

  return { app, tenantOrm, platformOrm, tenantEm, platformEm };
}
