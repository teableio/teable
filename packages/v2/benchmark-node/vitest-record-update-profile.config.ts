import { defineConfig } from 'vitest/config';

import { recordUpdateRetentionPlugin } from './src/retention/observeBulkUpdate';
import baseConfig from './vitest.config';

export default defineConfig({
  ...baseConfig,
  plugins: [
    ...(baseConfig.plugins ?? []),
    recordUpdateRetentionPlugin(process.env.RECORD_UPDATE_PROFILE_MODE === 'retention'),
  ],
  test: {
    ...baseConfig.test,
    include: ['src/record-update-retention.profile.ts'],
    passWithNoTests: false,
    pool: 'threads',
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});
