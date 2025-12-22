import { afterEach, beforeEach } from 'vitest';

import { createV2NodeTestContainer } from './src/testkit/createV2NodeTestContainer';
import {
  getV2NodeTestContainer,
  resetV2NodeTestContainer,
  setV2NodeTestContainer,
} from './src/testkit/v2NodeTestContainer';

beforeEach(async () => {
  setV2NodeTestContainer(await createV2NodeTestContainer());
});

afterEach(async () => {
  const current = getV2NodeTestContainer();
  await current.dispose();
  resetV2NodeTestContainer();
});
