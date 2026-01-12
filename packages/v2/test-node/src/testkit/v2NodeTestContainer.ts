import type { BaseId, MemoryEventBus, ITableRepository } from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';

let current: IV2NodeTestContainer | undefined;

export interface IV2NodeTestContainer {
  container: DependencyContainer;
  tableRepository: ITableRepository;
  eventBus: MemoryEventBus;
  baseId: BaseId;
  processOutbox(): Promise<number>;
  dispose(): Promise<void>;
}

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
