import { afterEach } from 'vitest';

import { peekV2NodeTestContainer, resetV2NodeTestContainer } from './v2NodeTestContainer';

afterEach(async () => {
  const current = peekV2NodeTestContainer();
  try {
    await current?.dispose();
  } catch {
    // Some specs dispose explicitly in file-local hooks.
  } finally {
    resetV2NodeTestContainer();
  }
});
