import { NoopLogger, v2CoreTokens } from '@teable/v2-core';
import { container } from '@teable/v2-di';
import { describe, expect, it } from 'vitest';

import { registerV2TableOps } from './di';
import { NoopTableSearchVectorSchemaMaintenanceScheduler } from './ports';
import { TableSearchVectorSchemaMaintenanceProjection } from './searchVectorSchemaMaintenance';
import { v2TableOpsTokens } from './tokens';

describe('registerV2TableOps', () => {
  it('registers the search-vector maintenance projection without a postgres adapter', () => {
    const child = container.createChildContainer();
    child.registerInstance(v2CoreTokens.logger, new NoopLogger());
    child.registerInstance(v2CoreTokens.tableRepository, {
      findOne: async () => {
        throw new Error('not used');
      },
    });

    registerV2TableOps(child);

    expect(child.isRegistered(v2TableOpsTokens.searchVectorSchemaMaintenanceScheduler)).toBe(true);
    expect(child.isRegistered(TableSearchVectorSchemaMaintenanceProjection)).toBe(true);

    const scheduler = child.resolve(v2TableOpsTokens.searchVectorSchemaMaintenanceScheduler);
    expect(scheduler).toBeInstanceOf(NoopTableSearchVectorSchemaMaintenanceScheduler);

    expect(() => child.resolve(TableSearchVectorSchemaMaintenanceProjection)).not.toThrow();
  });

  it('keeps an already-registered postgres scheduler', () => {
    const child = container.createChildContainer();
    const existing = {
      schedule: async () => {
        throw new Error('not used');
      },
    };
    child.registerInstance(v2TableOpsTokens.searchVectorSchemaMaintenanceScheduler, existing);

    registerV2TableOps(child);

    expect(child.resolve(v2TableOpsTokens.searchVectorSchemaMaintenanceScheduler)).toBe(existing);
  });
});
