import swc from 'unplugin-swc';
import tsconfigPaths from 'vite-tsconfig-paths';
import { configDefaults, defineConfig } from 'vitest/config';

const testFiles = ['**/src/**/*.{test,spec}.{js,ts}'];

// V8 coverage instrumentation makes these suites several times slower; the Sonar coverage runner
// (scripts/sonar-coverage.mjs) sets SONAR_COVERAGE_RUN so the per-test limits can be relaxed there.
const coverageRun = process.env.SONAR_COVERAGE_RUN === '1';

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
  cacheDir: '../../.cache/vitest/nestjs-backend/unit',
  test: {
    testTimeout: coverageRun ? 180_000 : 5_000,
    hookTimeout: coverageRun ? 180_000 : 10_000,
    globals: true,
    environment: 'node',
    setupFiles: './vitest.setup.ts',
    passWithNoTests: true,
    pool: 'forks',
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage/unit',
      include: ['src/**/*.{js,ts}'],
    },
    include: testFiles,
    exclude: [
      ...configDefaults.exclude,
      '**/*.controller.spec.ts', // exclude controller test
      '**/.next/**',
    ],
  },
});
