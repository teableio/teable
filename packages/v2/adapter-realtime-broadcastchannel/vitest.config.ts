import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    conditions: ['@teable/source'],
  },
  ssr: {
    resolve: {
      conditions: ['@teable/source'],
      externalConditions: ['@teable/source'],
    },
  },
  test: {
    include: ['src/**/*.spec.ts'],
  },
});
