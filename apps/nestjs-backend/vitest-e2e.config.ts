import swc from 'unplugin-swc';
import tsconfigPaths from 'vite-tsconfig-paths';
import { configDefaults, defineConfig } from 'vitest/config';
import { resolveE2eMaxWorkers } from './test/utils/e2e-shared';
import { v2CoveredV1TableIntegrationFiles } from './v2-covered-v1-table-integrations';

// Set timezone to UTC for deterministic datetime test results
// This must be set before any datetime operations
process.env.TZ = 'UTC';

if (!process.env.CONDITIONAL_QUERY_MAX_LIMIT) {
  process.env.CONDITIONAL_QUERY_MAX_LIMIT = '7';
}

if (!process.env.CONDITIONAL_QUERY_DEFAULT_LIMIT) {
  process.env.CONDITIONAL_QUERY_DEFAULT_LIMIT = process.env.CONDITIONAL_QUERY_MAX_LIMIT;
}

// Shared-app worker model (see test/utils/e2e-shared.ts): workers reuse one Nest
// app across spec files and run files in parallel against per-worker databases.
process.env.E2E_SHARED_APP ??= '1';
process.env.E2E_WORKER_DB ??= '1';
// V2 is fully rolled out; the suite exercises the v2 write path by default, the same
// as the EE community-host run. Export FORCE_V2_ALL=false to run the legacy v1 baseline.
process.env.FORCE_V2_ALL ??= 'true';
const e2eMaxWorkers = resolveE2eMaxWorkers();

const timeout = process.env.CI ? 60000 : 10000;
// Anchored at test/ so the glob never has to crawl node_modules.
const testFiles = ['test/**/*.{e2e-test,e2e-spec}.{js,ts}'];
// Retired v1 table suites (covered by the v2 e2e package) are skipped, as in the EE
// community-host run. Set E2E_INCLUDE_RETIRED_V1=1 to run one of them locally.
const retiredV1Files =
  process.env.E2E_INCLUDE_RETIRED_V1 === '1'
    ? []
    : v2CoveredV1TableIntegrationFiles.map((file) => `test/${file}`);

export default defineConfig({
  resolve: {
    alias: {
      buffer: 'node:buffer',
    },
    conditions: ['@teable/source'],
  },
  ssr: {
    resolve: {
      conditions: ['@teable/source'],
      externalConditions: ['@teable/source'],
    },
  },
  plugins: [
    swc.vite({
      jsc: {
        target: 'es2022',
      },
    }),
    // The mobile app's tsconfig extends expo's, which is not installed here; skip it.
    tsconfigPaths({ ignoreConfigErrors: true }),
  ],
  cacheDir: '../../.cache/vitest/nestjs-backend/e2e',
  test: {
    globals: true,
    environment: 'node',
    setupFiles: './vitest-e2e.setup.ts',
    globalSetup: './vitest-e2e.global-setup.ts',
    runner: './test/utils/e2e-test-runner.ts',
    testTimeout: timeout,
    hookTimeout: timeout,
    passWithNoTests: true,
    pool: 'forks',
    isolate: process.env.E2E_ISOLATE === '1',
    fileParallelism: e2eMaxWorkers > 1,
    maxWorkers: e2eMaxWorkers,
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage/e2e',
      include: ['src/**/*.{js,ts}'],
    },
    sequence: {
      hooks: 'stack',
    },
    logHeapUsage: true,
    reporters: ['verbose'],
    include: testFiles,
    exclude: [...configDefaults.exclude, '**/.next/**', ...retiredV1Files],
  },
});
