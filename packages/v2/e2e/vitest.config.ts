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
  cacheDir: '../../../.cache/vitest/v2-e2e',
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 60000,
    hookTimeout: 60000,
    passWithNoTests: true,
    setupFiles: ['./src/shared/vitest.setup.ts'],
    typecheck: {
      enabled: false,
    },
    pool: 'forks',
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      allowExternal: true,
      include: ['../*/src/**/*.ts', '../../formula/src/**/*.ts'],
      exclude: [
        '**/*.spec.ts',
        '**/*.test.ts',
        '**/testkit/**',
        '**/test/**',
        '**/__tests__/**',
        '**/*.md',
      ],
      reporter: ['text', 'json', 'lcov', 'html'],
      reportsDirectory: './coverage',
    },
    clearMocks: true,
    mockReset: true,
    restoreMocks: true,
    include: testFiles,
    exclude: [...configDefaults.exclude, '**/.next/**'],
  },
});
