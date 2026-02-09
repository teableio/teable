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
  cacheDir: '../../.cache/vitest/openapi',
  test: {
    globals: true,
    environment: 'node',
    setupFiles: './vitest.setup.js',
    passWithNoTests: true,
    typecheck: {
      enabled: false,
    },
    pool: 'forks',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{js,ts}'],
    },
    // To mimic Jest behaviour regarding mocks.
    // @link https://vitest.dev/config/#clearmocks
    clearMocks: true,
    mockReset: true,
    restoreMocks: true,
    include: testFiles,
    exclude: [...configDefaults.exclude],
  },
});
