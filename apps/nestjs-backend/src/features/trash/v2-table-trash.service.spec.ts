import { ResourceType } from '@teable/openapi';
import { v2DataDbTokens, v2MetaDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import {
  ActorId,
  BaseId,
  type IExecutionContext,
  RecordId,
  RecordsDeleted,
  TableId,
  TableName,
  TableRestored,
  TableTrashed,
} from '@teable/v2-core';
import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
  type DatabaseConnection,
  type Driver,
  type QueryResult,
} from 'kysely';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@teable/db-main-prisma', () => ({
  PrismaModule: class PrismaModule {},
  DataPrismaModule: class DataPrismaModule {},
  PrismaService: class PrismaService {},
  MetaPrismaService: class MetaPrismaService {},
  PgPoolRegistry: class PgPoolRegistry {},
  DataPrismaService: class DataPrismaService {},
}));

import type { IDeleteRecordsPayload } from '../undo-redo/operations/delete-records.operation';
import { V2RecordTrashService } from './v2-record-trash.service';
import {
  V2RecordsDeletedAttachmentProjection,
  V2RecordsDeletedTableTrashProjection,
  V2TableRestoredProjection,
  V2TableTrashedProjection,
} from './v2-table-trash.service';

class FakeSpan {
  end = () => undefined;
  recordError = (_message: string) => undefined;
  setAttribute = (_key: string, _value: string | number | boolean) => undefined;
  setAttributes = (_attributes: Record<string, string | number | boolean>) => undefined;
}

class FakeTracer {
  readonly spans: Array<{ name: string; attributes?: Record<string, string | number | boolean> }> =
    [];

  startSpan(name: string, attributes?: Record<string, string | number | boolean>) {
    this.spans.push({ name, attributes });
    return new FakeSpan();
  }

  async withSpan<T>(_span: FakeSpan, callback: () => Promise<T>): Promise<T> {
    return callback();
  }

  getActiveSpan() {
    return undefined;
  }
}

interface IRecordTrashInsertRow {
  /* eslint-disable @typescript-eslint/naming-convention */
  record_id: string;
  snapshot: unknown;
}

const createV2ContainerService = () => {
  const deleteQuery = {
    where: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue(undefined),
  };
  const insertQuery = {
    values: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue(undefined),
  };
  const selectQuery = {
    where: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    executeTakeFirst: vi.fn().mockResolvedValue({
      base_id: 'bseaaaaaaaaaaaaaaaa',
      deleted_time: new Date('2026-03-12T00:00:00.000Z'),
    }),
  };
  const trashSelectQuery = {
    where: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    executeTakeFirst: vi.fn().mockResolvedValue(undefined),
  };
  const db = {
    deleteFrom: vi.fn().mockReturnValue(deleteQuery),
    insertInto: vi.fn().mockReturnValue(insertQuery),
    selectFrom: vi.fn((table: string) => (table === 'trash' ? trashSelectQuery : selectQuery)),
  };
  const dataDb = {
    deleteFrom: vi.fn().mockReturnValue(deleteQuery),
    insertInto: vi.fn().mockReturnValue(insertQuery),
    transaction: vi.fn(() => ({
      execute: vi.fn(async () => undefined),
    })),
  };
  const container = {
    resolve: vi.fn((token: symbol) => {
      if (token === v2MetaDbTokens.db) {
        return db;
      }
      if (token === v2DataDbTokens.db) {
        return dataDb;
      }
      throw new Error(`Unexpected token ${String(token)}`);
    }),
  };

  return {
    db,
    dataDb,
    deleteQuery,
    insertQuery,
    selectQuery,
    trashSelectQuery,
    service: {
      getContainer: vi.fn().mockResolvedValue(container),
      getContainerForTable: vi.fn().mockResolvedValue(container),
    },
  };
};

describe('V2TableTrashedProjection', () => {
  it('writes a table trash entry for soft-deleted tables', async () => {
    const deletedTime = new Date('2026-03-12T00:00:00.000Z');
    const {
      db,
      dataDb,
      deleteQuery,
      insertQuery,
      selectQuery,
      service: v2ContainerService,
    } = createV2ContainerService();
    const projection = new V2TableTrashedProjection(v2ContainerService as never);
    const context = {
      actorId: ActorId.create('usrTestUserId')._unsafeUnwrap(),
    };
    const event = TableTrashed.create({
      tableId: TableId.create('tblaaaaaaaaaaaaaaaa')._unsafeUnwrap(),
      baseId: BaseId.create('bseaaaaaaaaaaaaaaaa')._unsafeUnwrap(),
      tableName: TableName.create('Trash Me')._unsafeUnwrap(),
      fieldIds: [],
      viewIds: [],
    });

    const result = await projection.handle(context, event);

    expect(result._unsafeUnwrap()).toBeUndefined();
    expect(db.selectFrom).toHaveBeenCalledWith('table_meta');
    expect(selectQuery.where).toHaveBeenCalledWith('id', '=', 'tblaaaaaaaaaaaaaaaa');
    expect(selectQuery.select).toHaveBeenCalledWith(['base_id', 'deleted_time']);
    expect(db.selectFrom).toHaveBeenCalledWith('trash');
    expect(db.deleteFrom).not.toHaveBeenCalledWith('trash');
    expect(db.insertInto).toHaveBeenCalledWith('trash');
    expect(insertQuery.values).toHaveBeenCalledWith({
      id: expect.any(String),
      resource_id: 'tblaaaaaaaaaaaaaaaa',
      resource_type: ResourceType.Table,
      parent_id: 'bseaaaaaaaaaaaaaaaa',
      deleted_time: deletedTime,
      deleted_by: 'usrTestUserId',
    });
    expect(v2ContainerService.getContainerForTable).toHaveBeenCalledWith('tblaaaaaaaaaaaaaaaa');
    expect(dataDb.deleteFrom).toHaveBeenCalledWith('table_trash');
    expect(dataDb.insertInto).toHaveBeenCalledWith('table_trash');
    expect(insertQuery.values).toHaveBeenCalledWith({
      id: expect.any(String),
      table_id: 'tblaaaaaaaaaaaaaaaa',
      resource_type: ResourceType.Table,
      snapshot: JSON.stringify({
        tableId: 'tblaaaaaaaaaaaaaaaa',
        baseId: 'bseaaaaaaaaaaaaaaaa',
        name: 'Trash Me',
        fieldIds: [],
        viewIds: [],
      }),
      created_by: 'usrTestUserId',
      created_time: deletedTime,
    });
  });

  it('keeps a trash row already written by the delete transaction', async () => {
    const {
      db,
      trashSelectQuery,
      insertQuery,
      service: v2ContainerService,
    } = createV2ContainerService();
    trashSelectQuery.executeTakeFirst.mockResolvedValue({ id: 'trhAlreadyWritten' });
    const projection = new V2TableTrashedProjection(v2ContainerService as never);
    const event = TableTrashed.create({
      tableId: TableId.create('tblaaaaaaaaaaaaaaaa')._unsafeUnwrap(),
      baseId: BaseId.create('bseaaaaaaaaaaaaaaaa')._unsafeUnwrap(),
      tableName: TableName.create('Trash Me')._unsafeUnwrap(),
      fieldIds: [],
      viewIds: [],
    });

    const result = await projection.handle(
      { actorId: ActorId.create('usrTestUserId')._unsafeUnwrap() },
      event
    );

    expect(result._unsafeUnwrap()).toBeUndefined();
    expect(db.selectFrom).toHaveBeenCalledWith('trash');
    expect(db.insertInto).not.toHaveBeenCalledWith('trash');
    expect(insertQuery.values).toHaveBeenCalledWith(
      expect.objectContaining({ table_id: 'tblaaaaaaaaaaaaaaaa' })
    );
  });
});

describe('V2TableRestoredProjection', () => {
  it('removes a table trash entry after restore', async () => {
    const { db, dataDb, deleteQuery, service: v2ContainerService } = createV2ContainerService();
    const projection = new V2TableRestoredProjection(v2ContainerService as never);
    const context = {
      actorId: ActorId.create('usrTestUserId')._unsafeUnwrap(),
    };
    const event = TableRestored.create({
      tableId: TableId.create('tblaaaaaaaaaaaaaaaa')._unsafeUnwrap(),
      baseId: BaseId.create('bseaaaaaaaaaaaaaaaa')._unsafeUnwrap(),
      tableName: TableName.create('Restore Me')._unsafeUnwrap(),
      fieldIds: [],
      viewIds: [],
    });

    const result = await projection.handle(context, event);

    expect(result._unsafeUnwrap()).toBeUndefined();
    expect(db.deleteFrom).toHaveBeenCalledWith('trash');
    expect(deleteQuery.where).toHaveBeenNthCalledWith(1, 'resource_id', '=', 'tblaaaaaaaaaaaaaaaa');
    expect(deleteQuery.where).toHaveBeenNthCalledWith(2, 'resource_type', '=', ResourceType.Table);
    expect(v2ContainerService.getContainerForTable).toHaveBeenCalledWith('tblaaaaaaaaaaaaaaaa');
    expect(dataDb.deleteFrom).toHaveBeenCalledWith('table_trash');
  });
});

describe('V2RecordTrashService', () => {
  it('persists deleted records through the v2 Kysely db transaction', async () => {
    // Real Kysely + capture driver: the record_trash insert is a raw
    // jsonb_array_elements statement, so assert on the compiled queries.
    const executed: Array<{ sql: string; parameters: ReadonlyArray<unknown> }> = [];
    const connection: DatabaseConnection = {
      async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
        executed.push({ sql: compiledQuery.sql, parameters: compiledQuery.parameters });
        return { rows: [] };
      },
      // eslint-disable-next-line require-yield
      async *streamQuery(): AsyncIterableIterator<never> {
        throw new Error('not implemented');
      },
    };
    const driver: Driver = {
      init: async () => undefined,
      acquireConnection: async () => connection,
      beginTransaction: async () => undefined,
      commitTransaction: async () => undefined,
      rollbackTransaction: async () => undefined,
      releaseConnection: async () => undefined,
      destroy: async () => undefined,
    };
    const db = new Kysely({
      dialect: {
        createAdapter: () => new PostgresAdapter(),
        createDriver: () => driver,
        createIntrospector: (kysely) => new PostgresIntrospector(kysely),
        createQueryCompiler: () => new PostgresQueryCompiler(),
      },
    });
    const container = {
      resolve: vi.fn((token: symbol) => {
        if (token !== v2DataDbTokens.db) {
          throw new Error(`Unexpected token ${String(token)}`);
        }
        return db;
      }),
    };
    const v2ContainerService = {
      getContainerForTable: vi.fn().mockResolvedValue(container),
    };
    const service = new V2RecordTrashService(v2ContainerService as never);
    const tracer = new FakeTracer();
    const payload: IDeleteRecordsPayload = {
      operationId: 'oprTestTrashPersist',
      tableId: 'tblaaaaaaaaaaaaaaaa',
      userId: 'usrTestUserId',
      records: [
        {
          id: 'recFirstRecordId01',
          fields: { fldText: 'A' },
        },
        {
          id: 'recSecondRecordId2',
          fields: { fldText: 'B' },
        },
      ],
    };

    await service.persistDeletedRecords(payload, { tracer } as Pick<IExecutionContext, 'tracer'>);

    expect(v2ContainerService.getContainerForTable).toHaveBeenCalledWith('tblaaaaaaaaaaaaaaaa');
    expect(executed).toHaveLength(2);

    const tableTrashInsert = executed[0]!;
    expect(tableTrashInsert.sql).toContain('insert into "table_trash"');
    expect(tableTrashInsert.parameters).toContain('oprTestTrashPersist');
    expect(tableTrashInsert.parameters).toContain(
      JSON.stringify(['recFirstRecordId01', 'recSecondRecordId2'])
    );

    const recordTrashInsert = executed[1]!;
    // The insert target must stay on the query-builder AST (quoted identifier)
    // so BYODB internal-schema rewriting still applies to it.
    expect(recordTrashInsert.sql).toContain('insert into "record_trash"');
    expect(recordTrashInsert.sql).toContain('jsonb_array_elements');
    expect(recordTrashInsert.parameters).toContain('tblaaaaaaaaaaaaaaaa');
    expect(recordTrashInsert.parameters).toContain('usrTestUserId');
    expect(recordTrashInsert.parameters).toContain('oprTestTrashPersist');
    const rowsParam = recordTrashInsert.parameters.find(
      (parameter): parameter is string =>
        typeof parameter === 'string' && parameter.startsWith('[{')
    );
    expect(rowsParam).toBeDefined();
    const rows = JSON.parse(rowsParam!) as IRecordTrashInsertRow[];
    expect(rows.map((row) => row.record_id)).toEqual(['recFirstRecordId01', 'recSecondRecordId2']);
    expect(rows.map((row) => (row.snapshot as { fields: Record<string, unknown> }).fields)).toEqual(
      [{ fldText: 'A' }, { fldText: 'B' }]
    );
    expect(tracer.spans.map((span) => span.name)).toContain(
      'teable.V2RecordTrashService.persistDeletedRecords'
    );
  });

  it('fills existing marker snapshots instead of inserting record_trash rows', async () => {
    const executed: Array<{ sql: string; parameters: ReadonlyArray<unknown> }> = [];
    const connection: DatabaseConnection = {
      async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
        executed.push({ sql: compiledQuery.sql, parameters: compiledQuery.parameters });
        if (compiledQuery.sql.includes('update "record_trash"')) {
          return {
            rows: [{ record_id: 'recFirstRecordId01' }, { record_id: 'recSecondRecordId2' }] as R[],
          };
        }
        return { rows: [] };
      },
      // eslint-disable-next-line require-yield
      async *streamQuery(): AsyncIterableIterator<never> {
        throw new Error('not implemented');
      },
    };
    const driver: Driver = {
      init: async () => undefined,
      acquireConnection: async () => connection,
      beginTransaction: async () => undefined,
      commitTransaction: async () => undefined,
      rollbackTransaction: async () => undefined,
      releaseConnection: async () => undefined,
      destroy: async () => undefined,
    };
    const db = new Kysely({
      dialect: {
        createAdapter: () => new PostgresAdapter(),
        createDriver: () => driver,
        createIntrospector: (kysely) => new PostgresIntrospector(kysely),
        createQueryCompiler: () => new PostgresQueryCompiler(),
      },
    });
    const container = {
      resolve: vi.fn((token: symbol) => {
        if (token !== v2DataDbTokens.db) {
          throw new Error(`Unexpected token ${String(token)}`);
        }
        return db;
      }),
    };
    const v2ContainerService = {
      getContainerForTable: vi.fn().mockResolvedValue(container),
    };
    const service = new V2RecordTrashService(v2ContainerService as never);
    const payload: IDeleteRecordsPayload = {
      operationId: 'oprTestTrashFill',
      tableId: 'tblaaaaaaaaaaaaaaaa',
      userId: 'usrTestUserId',
      records: [
        { id: 'recFirstRecordId01', fields: { fldText: 'A' } },
        { id: 'recSecondRecordId2', fields: { fldText: 'B' } },
      ],
    };

    await service.persistDeletedRecords(payload, undefined, { fillExistingMarkers: true });

    const updateQuery = executed.find((query) => query.sql.includes('update "record_trash"'));
    expect(updateQuery?.sql).toContain('returning "record_id"');
    expect(executed.some((query) => query.sql.includes('insert into "table_trash"'))).toBe(true);
    expect(executed.some((query) => query.sql.includes('insert into "record_trash"'))).toBe(false);
  });

  it('skips snapshot insert when fillExistingMarkers finds no markers or table_trash index', async () => {
    const executed: Array<{ sql: string; parameters: ReadonlyArray<unknown> }> = [];
    const connection: DatabaseConnection = {
      async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
        executed.push({ sql: compiledQuery.sql, parameters: compiledQuery.parameters });
        return { rows: [] };
      },
      // eslint-disable-next-line require-yield
      async *streamQuery(): AsyncIterableIterator<never> {
        throw new Error('not implemented');
      },
    };
    const driver: Driver = {
      init: async () => undefined,
      acquireConnection: async () => connection,
      beginTransaction: async () => undefined,
      commitTransaction: async () => undefined,
      rollbackTransaction: async () => undefined,
      releaseConnection: async () => undefined,
      destroy: async () => undefined,
    };
    const db = new Kysely({
      dialect: {
        createAdapter: () => new PostgresAdapter(),
        createDriver: () => driver,
        createIntrospector: (kysely) => new PostgresIntrospector(kysely),
        createQueryCompiler: () => new PostgresQueryCompiler(),
      },
    });
    const container = {
      resolve: vi.fn((token: symbol) => {
        if (token !== v2DataDbTokens.db) {
          throw new Error(`Unexpected token ${String(token)}`);
        }
        return db;
      }),
    };
    const v2ContainerService = {
      getContainerForTable: vi.fn().mockResolvedValue(container),
    };
    const service = new V2RecordTrashService(v2ContainerService as never);
    const payload: IDeleteRecordsPayload = {
      operationId: 'oprTestTrashSkip',
      tableId: 'tblaaaaaaaaaaaaaaaa',
      userId: 'usrTestUserId',
      records: [{ id: 'recFirstRecordId01', fields: { fldText: 'A' } }],
    };

    await service.persistDeletedRecords(payload, undefined, { fillExistingMarkers: true });

    expect(executed.some((query) => query.sql.includes('update "record_trash"'))).toBe(true);
    expect(executed.some((query) => query.sql.includes('insert into "table_trash"'))).toBe(false);
    expect(executed.some((query) => query.sql.includes('insert into "record_trash"'))).toBe(false);
  });

  it('inserts record_trash snapshots when fillExistingMarkers finds a table_trash index', async () => {
    const executed: Array<{ sql: string; parameters: ReadonlyArray<unknown> }> = [];
    const connection: DatabaseConnection = {
      async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
        executed.push({ sql: compiledQuery.sql, parameters: compiledQuery.parameters });
        if (compiledQuery.sql.includes('select') && compiledQuery.sql.includes('"table_trash"')) {
          return {
            rows: [
              {
                id: 'oprExistingIndex01',
                snapshot: JSON.stringify(['recFirstRecordId01']),
                created_time: '2024-01-02T03:04:05.000Z',
              },
            ] as R[],
          };
        }
        return { rows: [] };
      },
      // eslint-disable-next-line require-yield
      async *streamQuery(): AsyncIterableIterator<never> {
        throw new Error('not implemented');
      },
    };
    const driver: Driver = {
      init: async () => undefined,
      acquireConnection: async () => connection,
      beginTransaction: async () => undefined,
      commitTransaction: async () => undefined,
      rollbackTransaction: async () => undefined,
      releaseConnection: async () => undefined,
      destroy: async () => undefined,
    };
    const db = new Kysely({
      dialect: {
        createAdapter: () => new PostgresAdapter(),
        createDriver: () => driver,
        createIntrospector: (kysely) => new PostgresIntrospector(kysely),
        createQueryCompiler: () => new PostgresQueryCompiler(),
      },
    });
    const container = {
      resolve: vi.fn((token: symbol) => {
        if (token !== v2DataDbTokens.db) {
          throw new Error(`Unexpected token ${String(token)}`);
        }
        return db;
      }),
    };
    const v2ContainerService = {
      getContainerForTable: vi.fn().mockResolvedValue(container),
    };
    const service = new V2RecordTrashService(v2ContainerService as never);
    const payload: IDeleteRecordsPayload = {
      operationId: 'oprTestTrashIndex',
      tableId: 'tblaaaaaaaaaaaaaaaa',
      userId: 'usrTestUserId',
      records: [{ id: 'recFirstRecordId01', fields: { fldText: 'A' } }],
    };

    await service.persistDeletedRecords(payload, undefined, { fillExistingMarkers: true });

    expect(executed.some((query) => query.sql.includes('update "record_trash"'))).toBe(true);
    expect(
      executed.some((query) => query.sql.includes('select') && query.sql.includes('"table_trash"'))
    ).toBe(true);
    expect(executed.some((query) => query.sql.includes('insert into "record_trash"'))).toBe(true);
    expect(executed.some((query) => query.sql.includes('insert into "table_trash"'))).toBe(false);
    expect(
      executed.some(
        (query) =>
          query.sql.includes('insert into "record_trash"') &&
          query.parameters.includes('2024-01-02T03:04:05.000Z')
      )
    ).toBe(true);
  });

  it('inserts record_trash snapshots when table_trash snapshot is already parsed', async () => {
    const executed: Array<{ sql: string; parameters: ReadonlyArray<unknown> }> = [];
    const connection: DatabaseConnection = {
      async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
        executed.push({ sql: compiledQuery.sql, parameters: compiledQuery.parameters });
        if (compiledQuery.sql.includes('select') && compiledQuery.sql.includes('"table_trash"')) {
          return {
            rows: [
              {
                id: 'oprExistingIndex01',
                snapshot: ['recFirstRecordId01'],
              },
            ] as R[],
          };
        }
        return { rows: [] };
      },
      // eslint-disable-next-line require-yield
      async *streamQuery(): AsyncIterableIterator<never> {
        throw new Error('not implemented');
      },
    };
    const driver: Driver = {
      init: async () => undefined,
      acquireConnection: async () => connection,
      beginTransaction: async () => undefined,
      commitTransaction: async () => undefined,
      rollbackTransaction: async () => undefined,
      releaseConnection: async () => undefined,
      destroy: async () => undefined,
    };
    const db = new Kysely({
      dialect: {
        createAdapter: () => new PostgresAdapter(),
        createDriver: () => driver,
        createIntrospector: (kysely) => new PostgresIntrospector(kysely),
        createQueryCompiler: () => new PostgresQueryCompiler(),
      },
    });
    const container = {
      resolve: vi.fn((token: symbol) => {
        if (token !== v2DataDbTokens.db) {
          throw new Error(`Unexpected token ${String(token)}`);
        }
        return db;
      }),
    };
    const v2ContainerService = {
      getContainerForTable: vi.fn().mockResolvedValue(container),
    };
    const service = new V2RecordTrashService(v2ContainerService as never);
    const payload: IDeleteRecordsPayload = {
      operationId: 'oprTestTrashParsed',
      tableId: 'tblaaaaaaaaaaaaaaaa',
      userId: 'usrTestUserId',
      records: [{ id: 'recFirstRecordId01', fields: { fldText: 'A' } }],
    };

    await service.persistDeletedRecords(payload, undefined, { fillExistingMarkers: true });

    expect(executed.some((query) => query.sql.includes('insert into "record_trash"'))).toBe(true);
  });
});

describe('V2RecordsDeletedTableTrashProjection', () => {
  it('uses display names carried by delete events without loading table metadata', async () => {
    const v2RecordTrashService = {
      persistDeletedRecords: vi.fn().mockResolvedValue(undefined),
    };
    const projection = new V2RecordsDeletedTableTrashProjection(v2RecordTrashService as never);
    const tracer = new FakeTracer();
    const context = {
      actorId: ActorId.create('usrTestUserId')._unsafeUnwrap(),
      windowId: 'winTestWindowId',
      tracer,
    };
    const event = RecordsDeleted.create({
      tableId: TableId.create('tblaaaaaaaaaaaaaaaa')._unsafeUnwrap(),
      baseId: BaseId.create('bseaaaaaaaaaaaaaaaa')._unsafeUnwrap(),
      recordIds: [RecordId.create(`rec${'a'.repeat(16)}`)._unsafeUnwrap()],
      recordSnapshots: [
        {
          id: 'recFirstRecordId01',
          fields: { fldText: 'A' },
          version: 7,
          displayName: 'Record A',
        },
      ],
      orchestration: {
        operationId: 'reqDeleteOperation01',
        totalRecordCount: 1,
        totalChunkCount: 1,
        chunkIndex: 0,
        scope: 'operation',
      },
    });

    const result = await projection.handle(context, event);

    expect(result._unsafeUnwrap()).toBeUndefined();
    expect(v2RecordTrashService.persistDeletedRecords).toHaveBeenCalledWith(
      {
        operationId: expect.any(String),
        windowId: 'winTestWindowId',
        tableId: 'tblaaaaaaaaaaaaaaaa',
        userId: 'usrTestUserId',
        records: [
          {
            id: 'recFirstRecordId01',
            fields: { fldText: 'A' },
            version: 7,
            name: 'Record A',
          },
        ],
      },
      context,
      { fillExistingMarkers: true }
    );
    expect(tracer.spans.map((span) => span.name)).toEqual(
      expect.arrayContaining([
        'teable.V2RecordsDeletedTableTrashProjection.buildTrashPayload',
        'teable.V2RecordsDeletedTableTrashProjection.persistDeletedRecords',
      ])
    );
  });
});

describe('V2RecordsDeletedAttachmentProjection', () => {
  it('deletes attachment rows for deleted records through the v2 db container', async () => {
    const { db, deleteQuery, service: v2ContainerService } = createV2ContainerService();
    const projection = new V2RecordsDeletedAttachmentProjection(v2ContainerService as never);
    const event = RecordsDeleted.create({
      tableId: TableId.create('tblaaaaaaaaaaaaaaaa')._unsafeUnwrap(),
      baseId: BaseId.create('bseaaaaaaaaaaaaaaaa')._unsafeUnwrap(),
      recordIds: [
        RecordId.create(`rec${'a'.repeat(16)}`)._unsafeUnwrap(),
        RecordId.create(`rec${'b'.repeat(16)}`)._unsafeUnwrap(),
      ],
      recordSnapshots: [],
      orchestration: {
        operationId: 'reqDeleteOperation02',
        totalRecordCount: 2,
        totalChunkCount: 1,
        chunkIndex: 0,
        scope: 'operation',
      },
    });

    const result = await projection.handle({} as never, event);

    expect(result._unsafeUnwrap()).toBeUndefined();
    expect(db.deleteFrom).toHaveBeenCalledWith('attachments_table');
    expect(deleteQuery.where).toHaveBeenNthCalledWith(1, 'table_id', '=', 'tblaaaaaaaaaaaaaaaa');
    expect(deleteQuery.where).toHaveBeenNthCalledWith(2, 'record_id', 'in', [
      `rec${'a'.repeat(16)}`,
      `rec${'b'.repeat(16)}`,
    ]);
    expect(deleteQuery.execute).toHaveBeenCalled();
  });
});
