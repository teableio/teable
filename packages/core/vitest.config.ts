import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

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
      threads: {
        singleThread: true,
      },
    },
    coverage: {
      provider: 'v8',
      reporter: [['lcov', { projectRoot: './src' }], ['json', { file: 'coverage.json' }], ['text']],
      extension: ['js', 'ts'],
      all: true,
    },
    // To mimic Jest behaviour regarding mocks.
    // @link https://vitest.dev/config/#clearmocks
    clearMocks: true,
    mockReset: true,
    restoreMocks: true,
    include: testFiles,
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.{idea,git,cache,output,temp}/**',
    ],
  },
});
