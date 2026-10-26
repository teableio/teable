import { beforeEach } from 'vitest';

import { createV2NodeUnitTestContainer } from './createV2NodeUnitTestContainer';
import { setV2NodeUnitTestContainer } from './v2NodeUnitTestContainer';

/**
 * Installs a fresh in-memory core container before each test in the calling file.
 *
 * This stays out of the global setup file on purpose: specs that never resolve the
 * container should not load the full core service graph just to clear it.
 */
export const useV2NodeUnitTestContainer = (): void => {
  beforeEach(() => {
    setV2NodeUnitTestContainer(createV2NodeUnitTestContainer());
  });
};
