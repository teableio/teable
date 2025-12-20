import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig, configDefaults } from 'vitest/config';

const benchFiles = ['./src/**/*.bench.{js,ts}'];

export default defineConfig({
  plugins: [tsconfigPaths()],
  cacheDir: '../../../.cache/vitest/v2-benchmark-node',
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 300000,
    hookTimeout: 300000,
    passWithNoTests: true,
    typecheck: {
      enabled: false,
    },
    pool: 'forks',
    fileParallelism: false,
    clearMocks: true,
    mockReset: true,
    restoreMocks: true,
    include: benchFiles,
    exclude: [...configDefaults.exclude, '**/.next/**'],
  },
});
