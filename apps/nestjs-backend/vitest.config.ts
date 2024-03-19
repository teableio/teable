import swc from 'unplugin-swc';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

const testFiles = ['**/src/**/*.{test,spec}.{js,ts}'];

export default defineConfig({
  plugins: [swc.vite({}), tsconfigPaths()],
  cacheDir: '../../.cache/vitest/nestjs-backend/unit',
  test: {
    globals: true,
    environment: 'node',
    passWithNoTests: true,
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
    include: testFiles,
    exclude: [
      '**/*.controller.spec.ts', // exclude controller test
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.{idea,git,cache,output,temp}/**',
    ],
  },
});
