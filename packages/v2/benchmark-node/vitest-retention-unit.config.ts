import { defineConfig } from 'vitest/config';

import baseConfig from './vitest.config';

export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    include: ['src/retention/*.spec.ts'],
    passWithNoTests: false,
    fileParallelism: false,
    maxWorkers: 1,
  },
});
