import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['@teable/source'] },
  ssr: { resolve: { conditions: ['@teable/source'], externalConditions: ['@teable/source'] } },
  test: {
    environment: 'node',
    include: ['./src/**/*.pg-benchmark.spec.ts'],
    fileParallelism: false,
    testTimeout: 300_000,
    hookTimeout: 30_000,
  },
});
