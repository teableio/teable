/* eslint-disable @typescript-eslint/naming-convention */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig, configDefaults } from 'vitest/config';

const rootDir = dirname(fileURLToPath(import.meta.url));

const benchFiles = ['./src/**/*.bench.{js,ts}'];
const isCI = Boolean(process.env.CI);

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      '@teable/formula': resolve(rootDir, '../../formula/src/index.ts'),
    },
  },
  cacheDir: '../../../.cache/vitest/v2-benchmark-node',
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 300000,
    hookTimeout: 300000,
    passWithNoTests: true,
    typecheck: {
      enabled: false,
    },
    pool: 'forks',
    fileParallelism: isCI,
    maxWorkers: isCI ? 2 : 1,
    clearMocks: true,
    mockReset: true,
    restoreMocks: true,
    include: benchFiles,
    exclude: [...configDefaults.exclude, '**/.next/**'],
  },
});
