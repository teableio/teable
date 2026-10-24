import { afterEach } from 'vitest';

import {
  peekV2NodeUnitTestContainer,
  resetV2NodeUnitTestContainer,
} from './v2NodeUnitTestContainer';

afterEach(async () => {
  const current = peekV2NodeUnitTestContainer();
  await current?.dispose();
  resetV2NodeUnitTestContainer();
});
