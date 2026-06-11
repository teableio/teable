import { FieldType as CoreFieldType } from '@teable/core';
import { v2DataDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import { describe, expect, it, vi } from 'vitest';
import { Events } from '../../event-emitter/events';
import {
  V2RecordsBatchUpdatedHistoryProjection,
  V2RecordUpdatedHistoryProjection,
} from './v2-record-history.service';

const okResult = <T>(value: T) => ({
  isErr: () => false,
  isOk: () => true,
  value,
});

const errResult = () => ({
  isErr: () => true,
  isOk: () => false,
});

const createTextField = (fieldId: string, name: string) => ({
  id: () => ({
    equals: (other: { toString(): string }) => other.toString() === fieldId,
  }),
  type: () => ({
    toString: () => CoreFieldType.SingleLineText,
  }),
  name: () => ({
    toString: () => name,
  }),
  computed: () => ({
    toBoolean: () => false,
  }),
  accept: (visitor: { visitSingleLineTextField(): unknown }) => visitor.visitSingleLineTextField(),
});

const createTable = (fields: Array<ReturnType<typeof createTextField>>) => ({
  getField: (predicate: (field: (typeof fields)[number]) => boolean) => {
    const field = fields.find(predicate);
    return field ? okResult(field) : errResult();
  },
});

const createV2ContainerService = () => {
  const query = {
    values: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue(undefined),
  };
  const db = {
    insertInto: vi.fn().mockReturnValue(query),
  };
  const container = {
    resolve: vi.fn((token: symbol) => {
      if (token !== v2DataDbTokens.db) {
        throw new Error(`Unexpected token ${String(token)}`);
      }

      return db;
    }),
  };

  return {
    db,
    query,
    service: {
      getContainer: vi.fn().mockResolvedValue(container),
    },
  };
};

describe('V2RecordUpdatedHistoryProjection', () => {
  it('writes record history entries through the v2 db container', async () => {
    const { db, query, service: v2ContainerService } = createV2ContainerService();
    const cls = {
      get: vi.fn().mockReturnValue('usrHistWriter00000001'),
    };
    const tableQueryService = {
      getById: vi
        .fn()
        .mockResolvedValue(okResult(createTable([createTextField('fldHistField0000001', 'Name')]))),
    };
    const eventEmitterService = {
      emit: vi.fn(),
    };
    const projection = new V2RecordUpdatedHistoryProjection(
      v2ContainerService as never,
      cls as never,
      { recordHistoryDisabled: false } as never,
      tableQueryService as never,
      eventEmitterService as never
    );

    const result = await projection.handle(
      {} as never,
      {
        source: 'user',
        tableId: { toString: () => 'tblHistTable0000001' },
        recordId: { toString: () => 'recHistRecord000001' },
        changes: [
          {
            fieldId: 'fldHistField0000001',
            oldValue: 'before',
            newValue: 'after',
          },
        ],
      } as never
    );

    expect(result._unsafeUnwrap()).toBeUndefined();
    expect(db.insertInto).toHaveBeenCalledWith('record_history');
    const [rows] = query.values.mock.calls[0] as [Array<Record<string, string>>];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      table_id: 'tblHistTable0000001',
      record_id: 'recHistRecord000001',
      field_id: 'fldHistField0000001',
      created_by: 'usrHistWriter00000001',
    });
    expect(JSON.parse(rows[0].before)).toEqual({
      meta: {
        type: CoreFieldType.SingleLineText,
        name: 'Name',
        options: null,
        cellValueType: 'string',
      },
      data: 'before',
    });
    expect(JSON.parse(rows[0].after)).toEqual({
      meta: {
        type: CoreFieldType.SingleLineText,
        name: 'Name',
        options: null,
        cellValueType: 'string',
      },
      data: 'after',
    });
    expect(query.execute).toHaveBeenCalledTimes(1);
    expect(eventEmitterService.emit).toHaveBeenCalledWith(Events.RECORD_HISTORY_CREATE, {
      recordIds: ['recHistRecord000001'],
    });
  });
});

describe('V2RecordsBatchUpdatedHistoryProjection', () => {
  it('writes batch record history entries through the v2 db container', async () => {
    const { db, query, service: v2ContainerService } = createV2ContainerService();
    const cls = {
      get: vi.fn().mockReturnValue('usrBatchWriter0000001'),
    };
    const tableQueryService = {
      getById: vi
        .fn()
        .mockResolvedValue(okResult(createTable([createTextField('fldHistField0000001', 'Name')]))),
    };
    const eventEmitterService = {
      emit: vi.fn(),
    };
    const projection = new V2RecordsBatchUpdatedHistoryProjection(
      v2ContainerService as never,
      cls as never,
      { recordHistoryDisabled: false } as never,
      tableQueryService as never,
      eventEmitterService as never
    );

    const result = await projection.handle(
      {} as never,
      {
        source: 'user',
        tableId: { toString: () => 'tblHistTable0000001' },
        updates: [
          {
            recordId: 'recHistRecord000001',
            changes: [
              {
                fieldId: 'fldHistField0000001',
                oldValue: 'before-1',
                newValue: 'after-1',
              },
            ],
          },
          {
            recordId: 'recHistRecord000002',
            changes: [
              {
                fieldId: 'fldHistField0000001',
                oldValue: 'before-2',
                newValue: 'after-2',
              },
            ],
          },
        ],
      } as never
    );

    expect(result._unsafeUnwrap()).toBeUndefined();
    expect(db.insertInto).toHaveBeenCalledWith('record_history');
    const [rows] = query.values.mock.calls[0] as [Array<Record<string, string>>];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      table_id: 'tblHistTable0000001',
      record_id: 'recHistRecord000001',
      field_id: 'fldHistField0000001',
      created_by: 'usrBatchWriter0000001',
    });
    expect(rows[1]).toMatchObject({
      table_id: 'tblHistTable0000001',
      record_id: 'recHistRecord000002',
      field_id: 'fldHistField0000001',
      created_by: 'usrBatchWriter0000001',
    });
    expect(query.execute).toHaveBeenCalledTimes(1);
    expect(eventEmitterService.emit).toHaveBeenCalledWith(Events.RECORD_HISTORY_CREATE, {
      recordIds: ['recHistRecord000001', 'recHistRecord000002'],
    });
  });
});
