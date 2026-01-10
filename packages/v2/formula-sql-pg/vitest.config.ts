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
      '@teable/formula': resolve(rootDir, '../../formula/src/index.ts'),
      '@teable/v2-container-node-test': resolve(rootDir, '../container-node-test/src/index.ts'),
      '@teable/v2-adapter-table-repository-postgres': resolve(
        rootDir,
        '../adapter-table-repository-postgres/src/index.ts'
      ),
      '@teable/v2-adapter-db-postgres-pg': resolve(
        rootDir,
        '../adapter-db-postgres-pg/src/index.ts'
      ),
      '@teable/v2-adapter-logger-console': resolve(
        rootDir,
        '../adapter-logger-console/src/index.ts'
      ),
      '@teable/v2-adapter-repository-postgres': resolve(
        rootDir,
        '../adapter-repository-postgres/src/index.ts'
      ),
      '@teable/v2-adapter-csv-parser-papaparse': resolve(
        rootDir,
        '../adapter-csv-parser-papaparse/src/index.ts'
      ),
    },
  },
  cacheDir: '../../../.cache/vitest/v2-formula-sql-pg',
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/testkit/vitest.setup.ts'],
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
