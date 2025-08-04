import swc from 'unplugin-swc';
import tsconfigPaths from 'vite-tsconfig-paths';
import { configDefaults, defineConfig } from 'vitest/config';

const benchFiles = ['**/test/**/*.bench.{js,ts}'];

export default defineConfig({
  plugins: [
    swc.vite({
      jsc: {
        target: 'es2022',
      },
    }),
    tsconfigPaths(),
  ],
  cacheDir: '../../.cache/vitest/nestjs-backend/bench',
  test: {
    globals: true,
    environment: 'node',
    setupFiles: './vitest-e2e.setup.ts',
    testTimeout: 60000, // Longer timeout for benchmarks
    passWithNoTests: true,
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    sequence: {
      hooks: 'stack',
    },
    logHeapUsage: true,
    reporters: ['verbose'],
    include: benchFiles,
    exclude: [...configDefaults.exclude, '**/.next/**'],
  },
});
