import { IdPrefix, ViewOpBuilder } from '@teable/core';
import { describe, expect, it, vi } from 'vitest';

const mockV2Tokens = vi.hoisted(() => ({
  v2MetaDbTokens: {
    db: Symbol('v2.meta.db'),
  },
  v2CoreTokens: {
    viewOperationPluginRunner: Symbol('v2.core.viewOperationPluginRunner'),
  },
}));

vi.mock('@teable/v2-adapter-db-postgres-pg', () => ({
  v2MetaDbTokens: mockV2Tokens.v2MetaDbTokens,
}));

vi.mock('@teable/v2-core', () => ({
  v2CoreTokens: mockV2Tokens.v2CoreTokens,
  ViewOperationKind: {
    update: 'update',
  },
}));

vi.mock('./v2-container.service', () => ({
  V2ContainerService: class V2ContainerService {},
}));

vi.mock('./v2-execution-context.factory', () => ({
  V2ExecutionContextFactory: class V2ExecutionContextFactory {},
}));

import { V2ViewCompatService } from './v2-view-compat.service';

const createV2ContainerService = (db: unknown, viewOperationPluginRunner: unknown) => ({
  getContainer: vi.fn().mockResolvedValue({
    resolve: vi.fn((token: symbol) => {
      if (token === mockV2Tokens.v2MetaDbTokens.db) {
        return db;
      }

      if (token === mockV2Tokens.v2CoreTokens.viewOperationPluginRunner) {
        return viewOperationPluginRunner;
      }

      throw new Error(`Unexpected token ${String(token)}`);
    }),
  }),
});

const okResult = <T>(value: T) => ({
  value,
  isErr: () => false,
});

const errResult = <T>(error: T) => ({
  error,
  isErr: () => true,
});

const createViewOperationPluginRunner = (guardResult = okResult(undefined)) => {
  const guard = vi.fn().mockResolvedValue(guardResult);
  const prepare = vi.fn().mockResolvedValue(okResult({ guard }));
  return { guard, prepare };
};

const createV2ContextFactory = () => ({
  createContext: vi.fn().mockResolvedValue({
    actorId: { toString: () => 'usrCompatWriter00001' },
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
    const viewOperationPluginRunner = createViewOperationPluginRunner();
    const v2ContainerService = createV2ContainerService(db, viewOperationPluginRunner);
    const v2ContextFactory = createV2ContextFactory();
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
    const service = new V2ViewCompatService(
      v2ContainerService as never,
      cls as never,
      v2ContextFactory as never
    );
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

    expect(viewOperationPluginRunner.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'update',
        payload: {
          tableId: 'tblCompatTable0001',
          viewId: 'viwCompat000000001',
          patch: { options: { frozenFieldId: 'fldNewFrozen00001' } },
        },
      })
    );
    expect(viewOperationPluginRunner.guard).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: expect.anything() })
    );
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

  it('rejects view updates when the v2 view operation plugin reports a limit error', async () => {
    const executeSelect = vi.fn().mockResolvedValue([{ id: 'viwCompat000000001', version: 3 }]);
    const selectQuery = {
      where: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      execute: executeSelect,
    };
    const updateQuery = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue(undefined),
    };
    const db = {
      selectFrom: vi.fn().mockReturnValue(selectQuery),
      updateTable: vi.fn().mockReturnValue(updateQuery),
    };
    const limitError = {
      code: 'validation.limit.view_options_max_bytes',
      message: 'Table data safety limit exceeded: validation.limit.view_options_max_bytes',
      details: { attempted: 16, max: 4 },
    };
    const viewOperationPluginRunner = createViewOperationPluginRunner(errResult(limitError));
    const v2ContainerService = createV2ContainerService(db, viewOperationPluginRunner);
    const cls = {
      getId: vi.fn().mockReturnValue('cls-request-id'),
      get: vi.fn().mockReturnValue(undefined),
      set: vi.fn(),
    };
    const service = new V2ViewCompatService(
      v2ContainerService as never,
      cls as never,
      createV2ContextFactory() as never
    );
    const ops = [
      ViewOpBuilder.editor.setViewProperty.build({
        key: 'options',
        oldValue: {},
        newValue: { frozenFieldId: 'fldNewFrozen00001' },
      }),
    ];

    await expect(
      service.batchUpdateViewByOps('tblCompatTable0001', {
        viwCompat000000001: ops,
      })
    ).rejects.toMatchObject({
      data: {
        domainCode: 'validation.limit.view_options_max_bytes',
        details: { attempted: 16, max: 4 },
      },
    });
    expect(db.updateTable).not.toHaveBeenCalled();
  });
});
