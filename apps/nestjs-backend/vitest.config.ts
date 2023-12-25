import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const testFiles = ['**/src/**/*.{test,spec}.{js,ts}'];

export default defineConfig({
  plugins: [swc.vite({})],
  test: {
    globals: true,
    environment: 'node',
    passWithNoTests: true,
    typecheck: {
      enabled: false,
    },
    cache: {
      dir: '../../.cache/vitest/nestjs-backend',
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
