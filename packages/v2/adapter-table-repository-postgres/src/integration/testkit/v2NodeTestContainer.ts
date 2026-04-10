import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';

let current: IV2NodeTestContainer | undefined;

export const setV2NodeTestContainer = (container: IV2NodeTestContainer): void => {
  current = container;
};

export const resetV2NodeTestContainer = (): void => {
  current = undefined;
};

export const getV2NodeTestContainer = (): IV2NodeTestContainer => {
  if (!current) {
    throw new Error('V2 node test container is not initialized (missing vitest setup?)');
  }
  return current;
};

export const peekV2NodeTestContainer = (): IV2NodeTestContainer | undefined => {
  return current;
};
