import { afterEach, beforeEach } from 'vitest';

import { createV2NodeUnitTestContainer } from './createV2NodeUnitTestContainer';
import {
  getV2NodeUnitTestContainer,
  resetV2NodeUnitTestContainer,
  setV2NodeUnitTestContainer,
} from './v2NodeUnitTestContainer';

beforeEach(async () => {
  setV2NodeUnitTestContainer(await createV2NodeUnitTestContainer());
});

afterEach(async () => {
  const current = getV2NodeUnitTestContainer();
  await current.dispose();
  resetV2NodeUnitTestContainer();
});
