import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const timeout = process.env.CI ? 30000 : 10000;
const testFiles = ['**/test/**/*.{e2e-test,e2e-spec}.{js,ts}'];

export default defineConfig({
  plugins: [swc.vite({})],
  test: {
    globals: true,
    environment: 'node',
    setupFiles: './vitest-e2e.setup.ts',
    testTimeout: timeout,
    passWithNoTests: true,
    cache: {
      dir: '../../.cache/vitest/nestjs-backend/e2e',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'clover'],
      extension: ['js', 'ts'],
      all: true,
    },
    logHeapUsage: true,
    reporters: ['verbose'],
    include: testFiles,
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.{idea,git,cache,output,temp}/**',
    ],
  },
});
