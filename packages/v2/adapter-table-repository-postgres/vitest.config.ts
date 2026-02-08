/* eslint-disable @typescript-eslint/naming-convention */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig, configDefaults } from 'vitest/config';

const testFiles = ['./src/**/*.{test,spec}.{js,ts}'];
const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      '@teable/v2-core': resolve(rootDir, '../core/src/index.ts'),
      '@teable/v2-di': resolve(rootDir, '../di/src/index.ts'),
      '@teable/v2-postgres-schema': resolve(rootDir, '../postgres-schema/src/index.ts'),
    },
  },
  cacheDir: '../../../.cache/vitest/v2-adapter-table-repository-postgres',
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 120000,
    hookTimeout: 120000,
    passWithNoTests: true,
    typecheck: {
      enabled: false,
    },
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      extension: ['.js', '.ts'],
      include: ['src/**/*'],
    },
    clearMocks: true,
    mockReset: true,
    restoreMocks: true,
    include: testFiles,
    exclude: [...configDefaults.exclude, '**/.next/**'],
  },
});
