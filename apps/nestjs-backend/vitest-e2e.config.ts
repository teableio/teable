import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const testFiles = ['**/test/**/*.{e2e-test,e2e-spec}.{js,ts}'];

export default defineConfig({
  plugins: [swc.vite({})],
  test: {
    globals: true,
    environment: 'node',
    setupFiles: './vitest-e2e.setup.ts',
    passWithNoTests: true,
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
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.{idea,git,cache,output,temp}/**',
    ],
  },
});
