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
import { describe, expect, it, vi } from 'vitest';

vi.mock('@teable/db-main-prisma', () => ({
  PrismaModule: class PrismaModule {},
  DataPrismaModule: class DataPrismaModule {},
  PrismaService: class PrismaService {},
  MetaPrismaService: class MetaPrismaService {},
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
  created_time: Date;
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
  const db = {
    deleteFrom: vi.fn().mockReturnValue(deleteQuery),
    insertInto: vi.fn().mockReturnValue(insertQuery),
    selectFrom: vi.fn().mockReturnValue(selectQuery),
  };
  const dataDb = {
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
    service: {
      getContainer: vi.fn().mockResolvedValue(container),
    },
  };
};

describe('V2TableTrashedProjection', () => {
  it('writes a table trash entry for soft-deleted tables', async () => {
    const deletedTime = new Date('2026-03-12T00:00:00.000Z');
    const {
      db,
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
    expect(db.deleteFrom).toHaveBeenCalledWith('trash');
    expect(deleteQuery.where).toHaveBeenNthCalledWith(1, 'resource_id', '=', 'tblaaaaaaaaaaaaaaaa');
    expect(deleteQuery.where).toHaveBeenNthCalledWith(2, 'resource_type', '=', ResourceType.Table);
    expect(db.insertInto).toHaveBeenCalledWith('trash');
    expect(insertQuery.values).toHaveBeenCalledWith({
      id: expect.any(String),
      resource_id: 'tblaaaaaaaaaaaaaaaa',
      resource_type: ResourceType.Table,
      parent_id: 'bseaaaaaaaaaaaaaaaa',
      deleted_time: deletedTime,
      deleted_by: 'usrTestUserId',
    });
  });
});

describe('V2TableRestoredProjection', () => {
  it('removes a table trash entry after restore', async () => {
    const { db, deleteQuery, service: v2ContainerService } = createV2ContainerService();
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
  });
});

describe('V2RecordTrashService', () => {
  it('persists deleted records through the v2 Kysely db transaction', async () => {
    const operations: Array<{ table: string; values: unknown }> = [];
    const trx = {
      insertInto: vi.fn((table: string) => ({
        values: (values: unknown) => ({
          execute: vi.fn(async () => {
            operations.push({ table, values });
          }),
          executeTakeFirst: vi.fn(async () => {
            operations.push({ table, values });
            return undefined;
          }),
        }),
      })),
    };
    const db = {
      transaction: vi.fn(() => ({
        execute: async (callback: (trx: typeof trx) => Promise<void>) => callback(trx),
      })),
    };
    const container = {
      resolve: vi.fn((token: symbol) => {
        if (token !== v2DataDbTokens.db) {
          throw new Error(`Unexpected token ${String(token)}`);
        }
        return db;
      }),
    };
    const v2ContainerService = {
      getContainer: vi.fn().mockResolvedValue(container),
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

    expect(v2ContainerService.getContainer).toHaveBeenCalled();
    expect(db.transaction).toHaveBeenCalled();
    expect(operations).toHaveLength(2);
    expect(operations[0]).toEqual({
      table: 'table_trash',
      values: {
        id: 'oprTestTrashPersist',
        table_id: 'tblaaaaaaaaaaaaaaaa',
        resource_type: 'record',
        snapshot: JSON.stringify(['recFirstRecordId01', 'recSecondRecordId2']),
        created_by: 'usrTestUserId',
        created_time: expect.any(Date),
      },
    });
    expect(operations[1].table).toBe('record_trash');
    expect(Array.isArray(operations[1].values)).toBe(true);
    const tableTrashValue = operations[0].values as { created_time: Date };
    const recordTrashValues = operations[1].values as IRecordTrashInsertRow[];
    expect(recordTrashValues.map((row) => row.record_id)).toEqual([
      'recFirstRecordId01',
      'recSecondRecordId2',
    ]);
    expect(
      recordTrashValues.every((row) => row.created_time === tableTrashValue.created_time)
    ).toBe(true);
    expect(tracer.spans.map((span) => span.name)).toContain(
      'teable.V2RecordTrashService.persistDeletedRecords'
    );
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
            name: 'Record A',
          },
        ],
      },
      context
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
