import { defineConfig, configDefaults } from 'vitest/config';

const testFiles = ['./src/**/*.{test,spec}.{js,ts}'];

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
  cacheDir: '../../../.cache/vitest/v2-container-node-test',
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 180000,
    hookTimeout: 180000,
    passWithNoTests: true,
    typecheck: {
      enabled: false,
    },
    pool: 'forks',
    fileParallelism: false,
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
