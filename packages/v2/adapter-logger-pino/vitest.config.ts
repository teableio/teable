import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig, configDefaults } from 'vitest/config';

const testFiles = ['./src/**/*.{test,spec}.{js,ts}'];

export default defineConfig({
  plugins: [tsconfigPaths()],
  cacheDir: '../../../.cache/vitest/v2-adapter-logger-pino',
  test: {
    globals: true,
    environment: 'node',
    passWithNoTests: true,
    typecheck: {
      enabled: false,
    },
    pool: 'forks',
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      extension: ['.js', '.ts'],
      include: ['src/**/*'],
    },
    clearMocks: true,
    mockReset: true,
    restoreMocks: true,
    include: testFiles,
    exclude: [...configDefaults.exclude, '**/.next/**'],
  },
});
