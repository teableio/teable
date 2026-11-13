import { defineConfig, configDefaults } from 'vitest/config';

// Date specs assert UTC values and fail on a machine in another time zone, so pin it as the backend
// e2e configs do. Set here so the forked test workers inherit it.
process.env.TZ = 'UTC';

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
      // The sources live outside this package's root, and Vitest matches these patterns against
      // absolute paths: a pattern starting with `../` matches no file and leaves the report empty.
      // Only files the tests load are reported; Vitest cannot transform an unloaded file outside root.
      include: ['**/packages/v2/*/src/**/*.ts', '**/packages/formula/src/**/*.ts'],
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
