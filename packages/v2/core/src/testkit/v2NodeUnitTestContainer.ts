import type { BaseId, ITableRepository, MemoryEventBus } from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';

let current: IV2NodeUnitTestContainer | undefined;

export interface IV2NodeUnitTestContainer {
  container: DependencyContainer;
  tableRepository: ITableRepository;
  eventBus: MemoryEventBus;
  baseId: BaseId;
  dispose(): Promise<void>;
}

export const setV2NodeUnitTestContainer = (container: IV2NodeUnitTestContainer): void => {
  current = container;
};

export const resetV2NodeUnitTestContainer = (): void => {
  current = undefined;
};

export const getV2NodeUnitTestContainer = (): IV2NodeUnitTestContainer => {
  if (!current) {
    throw new Error('V2 node unit test container is not initialized (missing vitest setup?)');
  }
  return current;
};
