import { afterEach, beforeEach, expect } from 'vitest';
import { createV2NodeTestContainer } from '@teable/v2-container-node-test';

import {
  getV2NodeTestContainer,
  resetV2NodeTestContainer,
  setV2NodeTestContainer,
} from './v2NodeTestContainer';

const shouldInitializeV2NodeTestContainer = () => {
  return expect.getState().testPath?.includes('/src/integration/') ?? false;
};

beforeEach(async () => {
  if (!shouldInitializeV2NodeTestContainer()) {
    resetV2NodeTestContainer();
    return;
  }
  setV2NodeTestContainer(await createV2NodeTestContainer());
});

afterEach(async () => {
  if (!shouldInitializeV2NodeTestContainer()) {
    resetV2NodeTestContainer();
    return;
  }
  try {
    await getV2NodeTestContainer().dispose();
  } catch {
    // Some migrated specs still dispose explicitly in file-local hooks.
  } finally {
    resetV2NodeTestContainer();
  }
});
