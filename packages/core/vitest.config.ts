import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig, configDefaults } from 'vitest/config';

const testFiles = ['./src/**/*.{test,spec}.{js,ts}'];

export default defineConfig({
  plugins: [tsconfigPaths()],
  cacheDir: '../../.cache/vitest/core',
  test: {
    globals: true,
    environment: 'node',
    setupFiles: './vitest.setup.js',
    passWithNoTests: true,
    typecheck: {
      enabled: false,
    },
    /*
    deps: {
      experimentalOptimizer: {
        enabled: true,
      },
    }, */
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    coverage: {
      provider: 'v8',
      extension: ['.js', '.ts'],
      include: ['src/**/*'],
    },
    // To mimic Jest behaviour regarding mocks.
    // @link https://vitest.dev/config/#clearmocks
    clearMocks: true,
    mockReset: true,
    restoreMocks: true,
    include: testFiles,
    exclude: [...configDefaults.exclude, '**/.next/**'],
  },
});
