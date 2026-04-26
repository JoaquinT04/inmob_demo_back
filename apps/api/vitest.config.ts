import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: '@inmob/shared', replacement: resolve(__dirname, '../../packages/shared/src/index.ts') },
      { find: '@inmob/database/entities', replacement: resolve(__dirname, '../../packages/database/src/entities/index.ts') },
      { find: '@inmob/database/config', replacement: resolve(__dirname, '../../packages/database/src/config.ts') },
      { find: '@inmob/database', replacement: resolve(__dirname, '../../packages/database/src/index.ts') },
      { find: '@inmob/platform', replacement: resolve(__dirname, '../../packages/platform/src/index.ts') },
    ],
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    setupFiles: ['src/__tests__/setup.ts'],
    testTimeout: 15000,
    fileParallelism: false,
    pool: 'forks',
    forks: {
      singleFork: true,
      execArgv: ['--max-old-space-size=2048'],
    },
  },
});
