import { defineConfig, configDefaults } from 'vitest/config';

const testFiles = ['./src/**/*.{test,spec}.{js,ts}'];
const isCI = Boolean(process.env.CI);

export default defineConfig({
  resolve: {
    conditions: ['@teable/source'],
  },
  ssr: {
    resolve: {
      conditions: ['@teable/source'],
      externalConditions: ['@teable/source'],
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
    fileParallelism: !isCI,
    maxWorkers: isCI ? 1 : undefined,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{js,ts}'],
    },
    clearMocks: true,
    mockReset: true,
    restoreMocks: true,
    include: testFiles,
    exclude: [...configDefaults.exclude, '**/.next/**'],
  },
});
