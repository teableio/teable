import { v2CoreTokens } from '@teable/v2-core';
import {
  v2DataDbTokens,
  v2MetaDbTokens,
  v2PostgresDbTokens,
} from '@teable/v2-adapter-db-postgres-pg';
import { container as rootContainer } from '@teable/v2-di';
import { describe, expect, it, vi } from 'vitest';

import { disposeV2NodePgContainer } from './index';

describe('disposeV2NodePgContainer', () => {
  it('destroys coordination before each unique Kysely handle once', async () => {
    const c = rootContainer.createChildContainer();
    const order: string[] = [];
    c.registerInstance(v2CoreTokens.tableSchemaCoordination, {
      destroy: vi.fn(async () => {
        order.push('coordination');
      }),
    });
    const shared = {
      destroy: vi.fn(async () => {
        order.push('shared');
      }),
    };
    const data = {
      destroy: vi.fn(async () => {
        order.push('data');
      }),
    };
    c.registerInstance(v2MetaDbTokens.db, shared);
    c.registerInstance(v2PostgresDbTokens.db, shared);
    c.registerInstance(v2DataDbTokens.db, data);

    await disposeV2NodePgContainer(c);

    expect(order).toEqual(['coordination', 'shared', 'data']);
    expect(shared.destroy).toHaveBeenCalledTimes(1);
    expect(data.destroy).toHaveBeenCalledTimes(1);
  });
});
