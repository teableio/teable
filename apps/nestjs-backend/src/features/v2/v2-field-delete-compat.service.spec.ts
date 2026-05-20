import { ViewOpBuilder } from '@teable/core';
import { describe, expect, it, vi } from 'vitest';
import { V2_FIELD_DELETE_COMPAT_CONTEXT_KEY } from './v2-field-delete-compat.constants';

const mockV2Tokens = vi.hoisted(() => ({
  v2DataDbTokens: {
    db: Symbol('v2.data.db'),
  },
}));

vi.mock('@teable/v2-adapter-db-postgres-pg', () => ({
  v2DataDbTokens: mockV2Tokens.v2DataDbTokens,
}));

vi.mock('./v2-container.service', () => ({
  V2ContainerService: class V2ContainerService {},
}));

vi.mock('./v2-view-compat.service', () => ({
  V2ViewCompatService: class V2ViewCompatService {},
}));

import { V2FieldDeletedCompatProjection } from './v2-field-delete-compat.service';

const createInsertDb = () => {
  const query = {
    values: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue(undefined),
  };
  const db = {
    insertInto: vi.fn().mockReturnValue(query),
  };

  return { db, query };
};

const createV2ContainerService = (db: unknown) => ({
  getContainer: vi.fn().mockResolvedValue({
    resolve: vi.fn((token: symbol) => {
      if (token !== mockV2Tokens.v2DataDbTokens.db) {
        throw new Error(`Unexpected token ${String(token)}`);
      }

      return db;
    }),
  }),
});

describe('V2FieldDeletedCompatProjection', () => {
  it('waits until the last deleted field before running compat updates', async () => {
    const { db, query } = createInsertDb();
    const projection = new V2FieldDeletedCompatProjection(
      createV2ContainerService(db) as never,
      {
        batchUpdateViewByOps: vi.fn(),
      } as never
    );
    const compatContext = {
      tableId: 'tblCompatTable0001',
      userId: 'usrCompatWriter00001',
      operationId: 'opCompatDelete000001',
      completed: undefined as boolean | undefined,
      remainingFieldIds: new Set(['fldCompatA00000001', 'fldCompatB00000001']),
      frozenFieldOps: {
        viwCompat000000001: [
          ViewOpBuilder.editor.setViewProperty.build({
            key: 'options',
            oldValue: { frozenFieldId: 'fldCompatA00000001' },
            newValue: { frozenFieldId: 'fldCompatB00000001' },
          }),
        ],
      },
      legacyDeletePayload: {
        fields: [{ id: 'fldCompatA00000001' }],
        records: [{ id: 'recCompat000000001' }],
      },
    };

    const executionContext = {
      [V2_FIELD_DELETE_COMPAT_CONTEXT_KEY]: compatContext,
    } as never;

    const result = await projection.handle(executionContext, {
      tableId: { toString: () => 'tblCompatTable0001' },
      fieldId: { toString: () => 'fldCompatA00000001' },
    } as never);

    expect(result._unsafeUnwrap()).toBeUndefined();
    expect(compatContext.completed).toBeUndefined();
    expect(compatContext.remainingFieldIds.has('fldCompatB00000001')).toBe(true);
    expect(db.insertInto).not.toHaveBeenCalled();
    expect(query.values).not.toHaveBeenCalled();
  });

  it('uses v2 view compat and table_trash writes when the final field is deleted', async () => {
    const { db, query } = createInsertDb();
    const v2ViewCompatService = {
      batchUpdateViewByOps: vi.fn().mockResolvedValue(undefined),
    };
    const projection = new V2FieldDeletedCompatProjection(
      createV2ContainerService(db) as never,
      v2ViewCompatService as never
    );
    const compatContext = {
      tableId: 'tblCompatTable0001',
      userId: 'usrCompatWriter00001',
      operationId: 'opCompatDelete000001',
      completed: undefined as boolean | undefined,
      remainingFieldIds: new Set(['fldCompatA00000001']),
      frozenFieldOps: {
        viwCompat000000001: [
          ViewOpBuilder.editor.setViewProperty.build({
            key: 'options',
            oldValue: { frozenFieldId: 'fldCompatA00000001' },
            newValue: { frozenFieldId: 'fldCompatB00000001' },
          }),
        ],
      },
      legacyDeletePayload: {
        fields: [{ id: 'fldCompatA00000001' }],
        records: [{ id: 'recCompat000000001' }],
      },
    };

    const executionContext = {
      [V2_FIELD_DELETE_COMPAT_CONTEXT_KEY]: compatContext,
    } as never;

    const result = await projection.handle(executionContext, {
      tableId: { toString: () => 'tblCompatTable0001' },
      fieldId: { toString: () => 'fldCompatA00000001' },
    } as never);

    expect(result._unsafeUnwrap()).toBeUndefined();
    expect(compatContext.completed).toBe(true);
    expect(v2ViewCompatService.batchUpdateViewByOps).toHaveBeenCalledWith(
      'tblCompatTable0001',
      compatContext.frozenFieldOps,
      executionContext
    );
    expect(db.insertInto).toHaveBeenCalledWith('table_trash');
    expect(query.values).toHaveBeenCalledWith({
      id: 'opCompatDelete000001',
      table_id: 'tblCompatTable0001',
      created_by: 'usrCompatWriter00001',
      resource_type: 'field',
      snapshot: JSON.stringify({
        fields: [{ id: 'fldCompatA00000001' }],
        records: [{ id: 'recCompat000000001' }],
      }),
    });
    expect(query.execute).toHaveBeenCalledTimes(1);
  });
});
