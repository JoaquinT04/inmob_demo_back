import { vi } from 'vitest';

vi.mock('@mikro-orm/reflection', () => ({
  TsMorphMetadataProvider: class TsMorphMetadataProvider {
    constructor() {}
  },
}));
