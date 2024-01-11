import swc from 'unplugin-swc';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

const testFiles = ['**/src/**/*.{test,spec}.{js,ts}'];

export default defineConfig({
  plugins: [swc.vite({}), tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
    passWithNoTests: true,
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
    cache: {
      dir: '../../.cache/vitest/nestjs-backend/unit',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'clover'],
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
