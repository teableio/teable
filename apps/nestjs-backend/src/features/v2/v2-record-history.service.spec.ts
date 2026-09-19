import { FieldType as CoreFieldType } from '@teable/core';
import { v2DataDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import { describe, expect, it, vi } from 'vitest';
import { Events } from '../../event-emitter/events';
import {
  V2RecordsBatchCreatedHistoryProjection,
  V2RecordsBatchUpdatedHistoryProjection,
  V2RecordUpdatedHistoryProjection,
} from './v2-record-history.service';

const okResult = <T>(value: T) => ({
  isErr: () => false,
  isOk: () => true,
  value,
});

const errResult = (error: unknown = { message: 'table not found' }) => ({
  isErr: () => true,
  isOk: () => false,
  error,
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

const createContext = (
  actorId: string,
  sameTxProjection?: {
    eventId: string;
    tables?: Map<string, unknown>;
    historyRowBudget?: { remaining: number };
  }
) => ({
  actorId: { toString: () => actorId },
  ...(sameTxProjection
    ? {
        sameTxProjection: {
          eventId: sameTxProjection.eventId,
          tables: sameTxProjection.tables ?? new Map(),
          historyRowBudget: sameTxProjection.historyRowBudget,
        },
      }
    : {}),
});

const createV2ContainerService = () => {
  const query = {
    values: vi.fn().mockReturnThis(),
    onConflict: vi.fn().mockReturnThis(),
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
      getContainerForTable: vi.fn().mockResolvedValue(container),
    },
  };
};

describe('V2RecordUpdatedHistoryProjection', () => {
  it('writes record history entries through the v2 db container', async () => {
    const { db, query, service: v2ContainerService } = createV2ContainerService();
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
      { recordHistoryDisabled: false } as never,
      tableQueryService as never,
      eventEmitterService as never
    );
    const context = createContext('usrHistWriter00000001');

    const result = await projection.handle(
      context as never,
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
    expect(rows[0].id).toMatch(/^rhi[0-9a-f]{24}$/);
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

  it('skips cell history when the table cannot be loaded', async () => {
    const { db, service: v2ContainerService } = createV2ContainerService();
    const tableQueryService = {
      getById: vi.fn().mockResolvedValue(errResult({ code: 'table.not_found' })),
    };
    const projection = new V2RecordUpdatedHistoryProjection(
      v2ContainerService as never,
      { recordHistoryDisabled: false } as never,
      tableQueryService as never,
      { emit: vi.fn() } as never
    );

    const result = await projection.handle(
      createContext('usrHistWriter00000001') as never,
      {
        source: 'user',
        tableId: { toString: () => 'tblHistTable0000001' },
        recordId: { toString: () => 'recHistRecord000001' },
        changes: [{ fieldId: 'fldHistField0000001', oldValue: 'before', newValue: 'after' }],
      } as never
    );

    expect(result.isOk()).toBe(true);
    expect(db.insertInto).not.toHaveBeenCalled();
  });

  it('shares the same-tx history row budget across events', async () => {
    const { db, service: v2ContainerService } = createV2ContainerService();
    const tableQueryService = {
      getById: vi
        .fn()
        .mockResolvedValue(okResult(createTable([createTextField('fldHistField0000001', 'Name')]))),
    };
    const projection = new V2RecordUpdatedHistoryProjection(
      v2ContainerService as never,
      { recordHistoryDisabled: false } as never,
      tableQueryService as never,
      { emit: vi.fn() } as never
    );
    const budget = { remaining: 200 };
    const context = createContext('usrHistWriter00000001', {
      eventId: 'evt-shared-budget',
      historyRowBudget: budget,
    });
    const event = {
      source: 'user',
      tableId: { toString: () => 'tblHistTable0000001' },
      recordId: { toString: () => 'recHistRecord000001' },
      changes: Array.from({ length: 150 }, (_, index) => ({
        fieldId: 'fldHistField0000001',
        oldValue: `before-${index}`,
        newValue: `after-${index}`,
      })),
    };

    const first = await projection.handle(context as never, event as never);
    const second = await projection.handle(context as never, event as never);

    expect(first.isOk()).toBe(true);
    expect(second.isOk()).toBe(true);
    expect(db.insertInto).toHaveBeenCalledTimes(1);
    expect(budget.remaining).toBe(50);
  });

  it('skips cell history when the same-tx row budget is exceeded', async () => {
    const { db, service: v2ContainerService } = createV2ContainerService();
    const tableQueryService = {
      getById: vi
        .fn()
        .mockResolvedValue(okResult(createTable([createTextField('fldHistField0000001', 'Name')]))),
    };
    const projection = new V2RecordUpdatedHistoryProjection(
      v2ContainerService as never,
      { recordHistoryDisabled: false } as never,
      tableQueryService as never,
      { emit: vi.fn() } as never
    );

    const result = await projection.handle(
      createContext('usrHistWriter00000001') as never,
      {
        source: 'user',
        tableId: { toString: () => 'tblHistTable0000001' },
        recordId: { toString: () => 'recHistRecord000001' },
        changes: Array.from({ length: 201 }, () => ({
          fieldId: 'fldHistField0000001',
          oldValue: 'a',
          newValue: 'b',
        })),
      } as never
    );

    expect(result.isOk()).toBe(true);
    expect(db.insertInto).not.toHaveBeenCalled();
  });

  it('defers RECORD_HISTORY_CREATE until after commit', async () => {
    const { service: v2ContainerService } = createV2ContainerService();
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
      { recordHistoryDisabled: false } as never,
      tableQueryService as never,
      eventEmitterService as never
    );
    const afterCommitHandlers: Array<() => Promise<void> | void> = [];
    const context = {
      actorId: { toString: () => 'usrHistWriter00000001' },
      transaction: {
        afterCommit: (handler: () => Promise<void> | void) => {
          afterCommitHandlers.push(handler);
        },
      },
    };

    await projection.handle(
      context as never,
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

    expect(eventEmitterService.emit).not.toHaveBeenCalled();
    await afterCommitHandlers[0]?.();
    expect(eventEmitterService.emit).toHaveBeenCalledWith(Events.RECORD_HISTORY_CREATE, {
      recordIds: ['recHistRecord000001'],
    });
  });
});

describe('V2RecordsBatchCreatedHistoryProjection', () => {
  it('writes created record history entries through the routed v2 data DB', async () => {
    const { db, query, service: v2ContainerService } = createV2ContainerService();
    const tableQueryService = {
      getById: vi
        .fn()
        .mockResolvedValue(okResult(createTable([createTextField('fldHistField0000001', 'Name')]))),
    };
    const eventEmitterService = {
      emit: vi.fn(),
    };
    const projection = new V2RecordsBatchCreatedHistoryProjection(
      v2ContainerService as never,
      { recordHistoryDisabled: false } as never,
      tableQueryService as never,
      eventEmitterService as never
    );
    const context = createContext('usrBatchCreator00001');

    const result = await projection.handle(
      context as never,
      {
        tableId: { toString: () => 'tblHistTable0000001' },
        source: { type: 'user' },
        records: [
          {
            recordId: 'recHistRecord000001',
            fields: [{ fieldId: 'fldHistField0000001', value: 'created-1' }],
          },
          {
            recordId: 'recHistRecord000002',
            fields: [{ fieldId: 'fldHistField0000001', value: 'created-2' }],
          },
        ],
      } as never
    );

    expect(result._unsafeUnwrap()).toBeUndefined();
    expect(v2ContainerService.getContainerForTable).toHaveBeenCalledWith('tblHistTable0000001');
    expect(db.insertInto).toHaveBeenCalledWith('record_history');
    const [rows] = query.values.mock.calls[0] as [Array<Record<string, string>>];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      table_id: 'tblHistTable0000001',
      record_id: 'recHistRecord000001',
      field_id: 'fldHistField0000001',
      created_by: 'usrBatchCreator00001',
    });
    expect(JSON.parse(rows[0].before)).toEqual({
      meta: {
        type: CoreFieldType.SingleLineText,
        name: 'Name',
        options: null,
        cellValueType: 'string',
      },
      data: null,
    });
    expect(JSON.parse(rows[0].after)).toEqual({
      meta: {
        type: CoreFieldType.SingleLineText,
        name: 'Name',
        options: null,
        cellValueType: 'string',
      },
      data: 'created-1',
    });
    expect(eventEmitterService.emit).toHaveBeenCalledWith(Events.RECORD_HISTORY_CREATE, {
      recordIds: ['recHistRecord000001', 'recHistRecord000002'],
    });
  });

  it.each([{ type: 'import' }, { type: 'tableDuplicate' }])(
    'skips record history for $type-sourced batch creation',
    async (source) => {
      const { db, service: v2ContainerService } = createV2ContainerService();
      const tableQueryService = {
        getById: vi
          .fn()
          .mockResolvedValue(
            okResult(createTable([createTextField('fldHistField0000001', 'Name')]))
          ),
      };
      const eventEmitterService = {
        emit: vi.fn(),
      };
      const projection = new V2RecordsBatchCreatedHistoryProjection(
        v2ContainerService as never,
        { recordHistoryDisabled: false } as never,
        tableQueryService as never,
        eventEmitterService as never
      );
      const context = createContext('usrBatchCreator00001');

      const result = await projection.handle(
        context as never,
        {
          tableId: { toString: () => 'tblHistTable0000001' },
          source,
          records: [
            {
              recordId: 'recHistRecord000001',
              fields: [{ fieldId: 'fldHistField0000001', value: 'created-1' }],
            },
          ],
        } as never
      );

      expect(result._unsafeUnwrap()).toBeUndefined();
      expect(db.insertInto).not.toHaveBeenCalled();
      expect(eventEmitterService.emit).not.toHaveBeenCalled();
    }
  );
});

describe('V2RecordsBatchUpdatedHistoryProjection', () => {
  it('writes batch record history entries through the v2 db container', async () => {
    const { db, query, service: v2ContainerService } = createV2ContainerService();
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
      { recordHistoryDisabled: false } as never,
      tableQueryService as never,
      eventEmitterService as never
    );
    const context = createContext('usrBatchWriter0000001');

    const result = await projection.handle(
      context as never,
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
