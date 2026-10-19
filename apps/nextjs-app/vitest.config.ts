import tsconfigPaths from 'vite-tsconfig-paths';
import { configDefaults, defineConfig } from 'vitest/config';

const testFiles = ['./src/**/*.{test,spec}.{js,jsx,ts,tsx}'];
// V8 coverage instrumentation makes heavy render tests several times slower; the Sonar coverage runner
// (scripts/sonar-coverage.mjs) sets SONAR_COVERAGE_RUN so the per-test limits can be relaxed there.
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
  // tsconfig keeps JSX for Next (`"jsx": "preserve"`), so the tests compile it here
  oxc: { jsx: { runtime: 'automatic' } },
  plugins: [tsconfigPaths()],
  cacheDir: '../../.cache/vitest/nextjs-app',
  test: {
    testTimeout: coverageRun ? 180_000 : 5_000,
    hookTimeout: coverageRun ? 180_000 : 10_000,
    globals: true,
    environment: 'happy-dom',
    passWithNoTests: false,
    setupFiles: './config/tests/setupVitest.ts',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{js,jsx,ts,tsx}', 'config/**/*.{js,jsx,ts,tsx}'],
    },
    include: testFiles,
    exclude: [...configDefaults.exclude, '**/.next/**'],
  },
});
