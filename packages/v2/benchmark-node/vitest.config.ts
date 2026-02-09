import { defineConfig, configDefaults } from 'vitest/config';

const benchFiles = ['./src/**/*.bench.{js,ts}'];
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
