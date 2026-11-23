import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import { v2CoreTokens, type ITableSchemaCoordination } from '@teable/v2-core';
import { vi } from 'vitest';

export interface ISchemaAcquisitionObserver {
  count(tableId: string): number;
  restore(): void;
}

export const observeSchemaAcquisitions = (
  container: IV2NodeTestContainer['container']
): ISchemaAcquisitionObserver => {
  const coordination = container.resolve<ITableSchemaCoordination>(
    v2CoreTokens.tableSchemaCoordination
  );
  const acquire = coordination.acquire.bind(coordination);
  const pending = new Set<{ tableIds: ReadonlyArray<string> }>();
  const spy = vi.spyOn(coordination, 'acquire').mockImplementation(async (...args) => {
    const attempt = { tableIds: args[1] };
    pending.add(attempt);
    try {
      return await acquire(...args);
    } finally {
      pending.delete(attempt);
    }
  });
  return {
    count: (tableId: string) => [...pending].filter(({ tableIds }) => tableIds.includes(tableId)).length,
    restore: () => spy.mockRestore(),
  };
};