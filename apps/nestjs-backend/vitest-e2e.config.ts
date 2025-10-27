import swc from 'unplugin-swc';
import tsconfigPaths from 'vite-tsconfig-paths';
import { configDefaults, defineConfig } from 'vitest/config';

if (!process.env.CONDITIONAL_QUERY_MAX_LIMIT) {
  process.env.CONDITIONAL_QUERY_MAX_LIMIT = '7';
}

if (!process.env.CONDITIONAL_QUERY_DEFAULT_LIMIT) {
  process.env.CONDITIONAL_QUERY_DEFAULT_LIMIT = process.env.CONDITIONAL_QUERY_MAX_LIMIT;
}

const timeout = process.env.CI ? 30000 : 10000;
const testFiles = ['**/test/**/*.{e2e-test,e2e-spec}.{js,ts}'];

export default defineConfig({
  plugins: [
    swc.vite({
      jsc: {
        target: 'es2022',
      },
    }),
    tsconfigPaths(),
  ],
  cacheDir: '../../.cache/vitest/nestjs-backend/e2e',
  test: {
    globals: true,
    environment: 'node',
    setupFiles: './vitest-e2e.setup.ts',
    testTimeout: timeout,
    hookTimeout: timeout,
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage/e2e',
      extension: ['.js', '.ts'],
      include: ['src/**/*'],
    },
    sequence: {
      hooks: 'stack',
    },
    logHeapUsage: true,
    reporters: ['verbose'],
    include: testFiles,
    exclude: [...configDefaults.exclude, '**/.next/**'],
  },
});
