import { defineConfig } from 'vitest/config';

// Deliberately separate from unit tests: this gate must use a native PostgreSQL
// optimizer and must fail (rather than skip) when its database is unavailable.
export default defineConfig({
  resolve: { conditions: ['@teable/source'] },
  ssr: { resolve: { conditions: ['@teable/source'], externalConditions: ['@teable/source'] } },
  test: {
    environment: 'node',
    include: ['./src/**/*.pg-plan.spec.ts'],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
