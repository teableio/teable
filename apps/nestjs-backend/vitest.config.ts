import swc from 'unplugin-swc';
import tsconfigPaths from 'vite-tsconfig-paths';
import { configDefaults, defineConfig } from 'vitest/config';

const testFiles = ['**/src/**/*.{test,spec}.{js,ts}'];

export default defineConfig({
  plugins: [
    swc.vite({
      jsc: {
        target: 'es2022',
      },
    }),
    tsconfigPaths(),
  ],
  cacheDir: '../../.cache/vitest/nestjs-backend/unit',
  test: {
    globals: true,
    environment: 'node',
    passWithNoTests: true,
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage/unit',
      extension: ['.js', '.ts'],
      include: ['src/**/*'],
    },
    include: testFiles,
    exclude: [
      ...configDefaults.exclude,
      '**/*.controller.spec.ts', // exclude controller test
      '**/.next/**',
    ],
  },
});
