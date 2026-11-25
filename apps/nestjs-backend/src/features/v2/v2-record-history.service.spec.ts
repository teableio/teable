import { FieldType as CoreFieldType } from '@teable/core';
import { v2DataDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import {
  ActorId,
  BackgroundTaskTracker,
  bindUnitOfWorkTransaction,
  DomainWriteTransaction,
  domainWrite,
  ok,
  err,
  domainError,
} from '@teable/v2-core';
import type {
  IExecutionContext,
  IUnitOfWork,
  IUnitOfWorkOptions,
  UnitOfWorkOperation,
  DomainError,
  Result,
} from '@teable/v2-core';
import { Kysely, PostgresDialect } from 'kysely';
import { describe, expect, it, vi } from 'vitest';
import { Events } from '../../event-emitter/events';
import {
  V2RecordsBatchCreatedHistoryProjection,
  V2RecordsBatchUpdatedHistoryProjection,
  V2RecordUpdatedHistoryProjection,
} from './v2-record-history.service';

const frozenTime = new Date('2026-09-01T10:00:00.000Z');
const occurredAt = { toDate: () => frozenTime };

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
  }
) => ({
  actorId: { toString: () => actorId },
  ...(sameTxProjection
    ? {
        sameTxProjection: {
          eventId: sameTxProjection.eventId,
          tables: sameTxProjection.tables ?? new Map(),
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
  it('sends UTC ISO timestamp text through the real PostgreSQL query compiler, never a Date parameter', async () => {
    const queries: Array<{ sql: string; parameters: unknown[] }> = [];
    const connection = {
      query: async (sql: string, parameters: unknown[]) => {
        queries.push({ sql, parameters });
        return { rows: [], command: 'INSERT', rowCount: 1 };
      },
      release: () => undefined,
    };
    const db = new Kysely({
      dialect: new PostgresDialect({
        pool: {
          connect: async () => connection,
          end: async () => undefined,
        } as never,
      }),
    });
    const { service } = createV2ContainerService();
    const projection = new V2RecordUpdatedHistoryProjection(
      service as never,
      { recordHistoryDisabled: false } as never,
      {
        getById: vi
          .fn()
          .mockResolvedValue(
            okResult(createTable([createTextField('fldHistField0000001', 'Name')]))
          ),
      } as never,
      { emit: vi.fn() } as never
    );
    const context = bindUnitOfWorkTransaction(
      createContext('usr-executor', { eventId: 'evt-offset-time' }) as never,
      { kind: 'unitOfWorkTransaction', scope: 'data', db } as never
    );
    try {
      const result = await projection.handle(context, {
        source: 'user',
        occurredAt: { toDate: () => new Date('2026-11-05T18:11:18.886+08:00') },
        tableId: { toString: () => 'tblHistTable0000001' },
        recordId: { toString: () => 'recHistRecord000001' },
        changes: [{ fieldId: 'fldHistField0000001', oldValue: 'before', newValue: 'after' }],
      } as never);
      expect(result.isOk()).toBe(true);
      expect(queries).toHaveLength(1);
      expect(queries[0].sql).toContain('"created_time"');
      expect(queries[0].parameters).toContain('2026-11-05T10:11:18.886Z');
      expect(queries[0].parameters.some((parameter) => parameter instanceof Date)).toBe(false);
    } finally {
      await db.destroy();
    }
  });

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
        occurredAt,
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
      actor_type: null,
      actor_id: null,
      created_time: frozenTime.toISOString(),
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

  it('fails required history when table metadata cannot be loaded', async () => {
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
        occurredAt,
        tableId: { toString: () => 'tblHistTable0000001' },
        recordId: { toString: () => 'recHistRecord000001' },
        changes: [{ fieldId: 'fldHistField0000001', oldValue: 'before', newValue: 'after' }],
      } as never
    );

    expect(result.isErr()).toBe(true);
    expect(db.insertInto).not.toHaveBeenCalled();
  });

  it('keeps distinct event identities and frozen actors across multiple modifications', async () => {
    const { db, query, service } = createV2ContainerService();
    const table = createTable([createTextField('fldHistField0000001', 'Name')]);
    const projection = new V2RecordUpdatedHistoryProjection(
      service as never,
      { recordHistoryDisabled: false } as never,
      { getById: vi.fn().mockResolvedValue(okResult(table)) } as never,
      { emit: vi.fn() } as never
    );
    const context = bindUnitOfWorkTransaction(
      {
        ...createContext('usrHistWriter00000001', { eventId: 'evt-first' }),
        initiator: { type: 'appUser', id: 'apu-stable-principal' },
      } as never,
      { kind: 'unitOfWorkTransaction', scope: 'data', db } as never
    );
    for (const eventId of ['evt-first', 'evt-second']) {
      const result = await projection.handle(
        {
          ...context,
          sameTxProjection: { eventId, tables: new Map() },
        } as never,
        {
          source: 'user',
          occurredAt,
          tableId: { toString: () => 'tblHistTable0000001' },
          recordId: { toString: () => 'recHistRecord000001' },
          changes: [{ fieldId: 'fldHistField0000001', oldValue: 'before', newValue: 'after' }],
        } as never
      );
      expect(result.isOk()).toBe(true);
    }
    expect(db.insertInto).toHaveBeenCalledTimes(2);
    expect(query.values.mock.calls[0][0][0]).toMatchObject({
      actor_type: 'appUser',
      actor_id: 'apu-stable-principal',
      created_time: frozenTime.toISOString(),
      created_by: 'usrHistWriter00000001',
    });
    expect(query.values.mock.calls[0][0][0].id).not.toBe(query.values.mock.calls[1][0][0].id);
  });

  it('writes every batch update beyond 200 in bounded inserts using the active data transaction', async () => {
    const { db, query, service } = createV2ContainerService();
    const projection = new V2RecordsBatchUpdatedHistoryProjection(
      service as never,
      { recordHistoryDisabled: false } as never,
      {
        getById: vi
          .fn()
          .mockResolvedValue(
            okResult(createTable([createTextField('fldHistField0000001', 'Name')]))
          ),
      } as never,
      { emit: vi.fn() } as never
    );
    const context = bindUnitOfWorkTransaction(
      createContext('usrHistWriter00000001', {
        eventId: 'evt-large',
      }) as never,
      { kind: 'unitOfWorkTransaction', scope: 'data', db } as never
    );
    const result = await projection.handle(context, {
      source: 'user',
      occurredAt,
      tableId: { toString: () => 'tblHistTable0000001' },
      updates: Array.from({ length: 401 }, (_, index) => ({
        recordId: `rec-batch-${index}`,
        changes: [{ fieldId: 'fldHistField0000001', oldValue: 'before', newValue: 'after' }],
      })),
    } as never);
    expect(result.isOk()).toBe(true);
    expect(query.values.mock.calls.map(([rows]) => rows.length)).toEqual([200, 200, 1]);
    expect(
      new Set(
        query.values.mock.calls.flatMap(([rows]) => rows.map((row: { id: string }) => row.id))
      ).size
    ).toBe(401);
    expect(service.getContainerForTable).not.toHaveBeenCalled();
  });

  it('fails rather than falling back outside a required same-tx projection', async () => {
    const { service } = createV2ContainerService();
    const projection = new V2RecordUpdatedHistoryProjection(
      service as never,
      { recordHistoryDisabled: false } as never,
      {
        getById: vi
          .fn()
          .mockResolvedValue(
            okResult(createTable([createTextField('fldHistField0000001', 'Name')]))
          ),
      } as never,
      { emit: vi.fn() } as never
    );
    const result = await projection.handle(
      createContext('usrHistWriter00000001', { eventId: 'evt-no-tx' }) as never,
      {
        source: 'user',
        occurredAt,
        tableId: { toString: () => 'tblHistTable0000001' },
        recordId: { toString: () => 'recHistRecord000001' },
        changes: [{ fieldId: 'fldHistField0000001', oldValue: 'before', newValue: 'after' }],
      } as never
    );
    expect(result.isErr()).toBe(true);
    expect(service.getContainerForTable).not.toHaveBeenCalled();
  });
  it('rolls back the mutation when a later history insert batch fails', async () => {
    const { db, query, service } = createV2ContainerService();
    query.execute
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('history disk failure'));
    const emitter = { emit: vi.fn() };
    const table = createTable([createTextField('fldHistField0000001', 'Name')]);
    const projection = new V2RecordsBatchUpdatedHistoryProjection(
      service as never,
      { recordHistoryDisabled: false } as never,
      { getById: vi.fn().mockResolvedValue(okResult(table)) } as never,
      emitter as never
    );
    let committed = false;
    let mutationVisible = false;
    let rolledBack = false;
    const unitOfWork: IUnitOfWork = {
      async withTransaction<T>(
        context: IExecutionContext,
        work: UnitOfWorkOperation<T>,
        _options?: IUnitOfWorkOptions
      ): Promise<Result<T, DomainError>> {
        const afterCommit: Array<() => void | Promise<void>> = [];
        const result = await work(
          bindUnitOfWorkTransaction(context, {
            kind: 'unitOfWorkTransaction',
            scope: 'data',
            db,
            afterCommit: (handler: () => void | Promise<void>) => afterCommit.push(handler),
          } as never)
        );
        if (result.isErr()) {
          mutationVisible = false;
          rolledBack = true;
          return err(result.error);
        }
        committed = true;
        for (const handler of afterCommit) await handler();
        return result;
      },
    };
    const journal = { append: vi.fn().mockResolvedValue(ok([])) };
    const transaction = new DomainWriteTransaction(
      unitOfWork,
      {
        encode: () =>
          err(domainError.unexpected({ message: 'must not encode same-tx-only history' })),
      } as never,
      {
        snapshot: () =>
          ok({
            generation: 1,
            resolve: () =>
              ok({
                messageName: 'history-test',
                durableMode: 'active',
                sameTxTargets: [
                  { consumerId: 'history', handler: V2RecordsBatchUpdatedHistoryProjection },
                ],
                durableTargets: [],
                directTargets: [],
              }),
          }),
      } as never,
      journal as never,
      { dispatch: vi.fn() } as never,
      {
        dispatch: async (context: IExecutionContext, event: unknown) =>
          projection.handle(context, event as never),
      } as never,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
      new BackgroundTaskTracker()
    );
    const event = {
      name: { toString: () => 'RecordsBatchUpdated' },
      source: 'user',
      occurredAt,
      tableId: { toString: () => 'tblHistTable0000001' },
      updates: Array.from({ length: 201 }, (_, index) => ({
        recordId: `rec-failure-${index}`,
        changes: [{ fieldId: 'fldHistField0000001', oldValue: 'before', newValue: 'after' }],
      })),
    };
    const result = await transaction.execute(
      { actorId: ActorId.create('usr-executor')._unsafeUnwrap() },
      async () => {
        mutationVisible = true;
        return ok(domainWrite.changed(undefined, [event as never]));
      }
    );
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('record_history.insert_failed');
    expect(query.execute).toHaveBeenCalledTimes(2);
    expect(rolledBack).toBe(true);
    expect(committed).toBe(false);
    expect(mutationVisible).toBe(false);
    expect(journal.append).not.toHaveBeenCalled();
    expect(emitter.emit).not.toHaveBeenCalled();
  });

  it.each([
    { source: 'computed', disabled: false, oldValue: 'before', newValue: 'after' },
    { source: 'user', disabled: true, oldValue: 'before', newValue: 'after' },
    { source: 'user', disabled: false, oldValue: 'same', newValue: 'same' },
  ])(
    'does not write intentional excluded history ($source, disabled=$disabled)',
    async ({ source, disabled, oldValue, newValue }) => {
      const { db, service } = createV2ContainerService();
      const projection = new V2RecordUpdatedHistoryProjection(
        service as never,
        { recordHistoryDisabled: disabled } as never,
        {
          getById: vi
            .fn()
            .mockResolvedValue(
              okResult(createTable([createTextField('fldHistField0000001', 'Name')]))
            ),
        } as never,
        { emit: vi.fn() } as never
      );
      const result = await projection.handle(
        createContext('usr-executor') as never,
        {
          source,
          occurredAt,
          tableId: { toString: () => 'tblHistTable0000001' },
          recordId: { toString: () => 'recHistRecord000001' },
          changes: [{ fieldId: 'fldHistField0000001', oldValue, newValue }],
        } as never
      );
      expect(result.isOk()).toBe(true);
      expect(db.insertInto).not.toHaveBeenCalled();
    }
  );

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
        occurredAt,
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
        occurredAt,
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
        occurredAt,
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
