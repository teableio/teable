import { configDefaults, defineConfig } from 'vitest/config';

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
  cacheDir: '../../../.cache/vitest/v2-adapter-db-postgres-shared',
  test: {
    globals: true,
    environment: 'node',
    pool: 'forks',
    fileParallelism: false,
    clearMocks: true,
    mockReset: true,
    restoreMocks: true,
    include: ['./src/**/*.{test,spec}.{js,ts}'],
    exclude: [...configDefaults.exclude, '**/.next/**'],
  },
});
