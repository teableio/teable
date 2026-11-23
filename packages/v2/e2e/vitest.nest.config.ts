import swc from 'unplugin-swc';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

process.env.TZ = 'UTC';
process.env.TEABLE_V2_E2E_HOST = 'nest';
process.env.TELEMETRY_ENABLED = 'false';

export default defineConfig({
  resolve: {
    alias: {
      buffer: 'node:buffer',
    },
    conditions: ['@teable/source'],
  },
  ssr: {
    resolve: {
      conditions: ['@teable/source'],
      externalConditions: ['@teable/source'],
    },
  },
  plugins: [
    swc.vite({
      jsc: {
        target: 'es2022',
      },
    }),
    tsconfigPaths({ ignoreConfigErrors: true }),
  ],
  cacheDir: '../../../.cache/vitest/v2-e2e-nest',
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 60000,
    hookTimeout: 60000,
    setupFiles: [
      '../../../apps/nestjs-backend/test/utils/v2-native-parity.setup.ts',
      './src/shared/vitest.setup.ts',
    ],
    globalSetup: ['../../../apps/nestjs-backend/vitest-e2e.global-setup.ts'],
    pool: 'forks',
    fileParallelism: false,
    include: ['./src/**/*.{test,spec}.{js,ts}'],
  },
});
