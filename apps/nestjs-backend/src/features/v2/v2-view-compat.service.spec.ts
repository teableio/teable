import { IdPrefix, ViewOpBuilder } from '@teable/core';
import { v2MetaDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import { describe, expect, it, vi } from 'vitest';
import { V2ViewCompatService } from './v2-view-compat.service';

const createV2ContainerService = (db: unknown) => ({
  getContainer: vi.fn().mockResolvedValue({
    resolve: vi.fn((token: symbol) => {
      if (token !== v2MetaDbTokens.db) {
        throw new Error(`Unexpected token ${String(token)}`);
      }

      return db;
    }),
  }),
});

describe('V2ViewCompatService', () => {
  it('updates matching views through the v2 db and stores raw ops in cls state', async () => {
    const executeSelect = vi.fn().mockResolvedValue([{ id: 'viwCompat000000001', version: 3 }]);
    const selectQuery = {
      where: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      execute: executeSelect,
    };
    const executeUpdate = vi.fn().mockResolvedValue(undefined);
    const updateQuery = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      execute: executeUpdate,
    };
    const db = {
      selectFrom: vi.fn().mockReturnValue(selectQuery),
      updateTable: vi.fn().mockReturnValue(updateQuery),
    };
    const v2ContainerService = createV2ContainerService(db);
    const clsState = new Map<string, unknown>();
    const cls = {
      getId: vi.fn().mockReturnValue('cls-request-id'),
      get: vi.fn((key: string) => {
        if (key === 'user.id') {
          return 'usrCompatWriter00001';
        }

        return clsState.get(key);
      }),
      set: vi.fn((key: string, value: unknown) => {
        clsState.set(key, value);
      }),
    };
    const service = new V2ViewCompatService(v2ContainerService as never, cls as never);
    const ops = [
      ViewOpBuilder.editor.setViewProperty.build({
        key: 'options',
        oldValue: { frozenFieldId: 'fldOldFrozen00001' },
        newValue: { frozenFieldId: 'fldNewFrozen00001' },
      }),
    ];

    await service.batchUpdateViewByOps('tblCompatTable0001', {
      viwCompat000000001: ops,
    });

    expect(db.selectFrom).toHaveBeenCalledWith('view');
    expect(db.updateTable).toHaveBeenCalledWith('view');
    expect(updateQuery.set).toHaveBeenCalledWith({
      options: JSON.stringify({ frozenFieldId: 'fldNewFrozen00001' }),
      version: 4,
      last_modified_by: 'usrCompatWriter00001',
    });
    expect(executeUpdate).toHaveBeenCalledTimes(1);

    const rawOpMaps = clsState.get('tx.rawOpMaps') as Array<
      Record<string, Record<string, unknown>>
    >;
    expect(rawOpMaps).toHaveLength(1);
    expect(Object.keys(rawOpMaps[0])).toEqual([`${IdPrefix.View}_tblCompatTable0001`]);
    expect(rawOpMaps[0][`${IdPrefix.View}_tblCompatTable0001`].viwCompat000000001).toMatchObject({
      op: ops,
      v: 3,
    });
  });
});
