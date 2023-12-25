import swc from 'unplugin-swc';
// import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

// const testFiles = ['./test/**/*.{e2e-test,e2e-spec}.{js,ts}'];
const testFiles = ['./test/field.e2e-spec.ts'];

export default defineConfig({
  plugins: [swc.vite({})],
  test: {
    globals: true,
    environment: 'node',
    setupFiles: './vitest-e2e.setup.ts',
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
