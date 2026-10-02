import { defineConfig, configDefaults } from 'vitest/config';

const testFiles = ['./src/**/*.{test,spec}.{js,ts}'];
const isCI = Boolean(process.env.CI);
// The formula matrix builds tables with hundreds of formula fields in beforeAll (~60 s uninstrumented);
// under the Sonar coverage runner (SONAR_COVERAGE_RUN) V8 instrumentation pushes that past two minutes.
const coverageRun = process.env.SONAR_COVERAGE_RUN === '1';

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
    testTimeout: coverageRun ? 600_000 : 120000,
    hookTimeout: coverageRun ? 600_000 : 120000,
    passWithNoTests: true,
    typecheck: {
      enabled: false,
    },
    pool: 'forks',
    isolate: false,
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
