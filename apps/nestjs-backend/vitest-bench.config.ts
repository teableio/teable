/* eslint-disable @typescript-eslint/naming-convention */
import swc from 'unplugin-swc';
import tsconfigPaths from 'vite-tsconfig-paths';
import type { Plugin } from 'vitest/config';
import { configDefaults, defineConfig } from 'vitest/config';

const benchFiles = ['**/test/**/*.bench.{js,ts}'];

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
  plugins: [
    swc.vite({
      jsc: {
        target: 'es2022',
      },
    }) as unknown as Plugin,
    tsconfigPaths(),
  ],
  cacheDir: '../../.cache/vitest/nestjs-backend/bench',
  test: {
    globals: true,
    environment: 'node',
    setupFiles: './vitest-e2e.setup.ts',
    testTimeout: 60000, // Longer timeout for benchmarks
    passWithNoTests: true,
    pool: 'forks',
    sequence: {
      hooks: 'stack',
    },
    logHeapUsage: true,
    reporters: ['verbose'],
    include: benchFiles,
    exclude: [...configDefaults.exclude, '**/.next/**'],
  },
});
