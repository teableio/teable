import { v2DataDbTokens, v2MetaDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import { BaseId, FieldId, TableDeleted, TableId, TableName } from '@teable/v2-core';
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
  type DatabaseConnection,
  type QueryResult,
} from 'kysely';
import { describe, expect, it, vi } from 'vitest';

import {
  type IV2TableDeleteSideEffectDb,
  V2TableDeletedResourceCleanupProjection,
  V2TableDeleteSideEffectService,
} from './v2-table-delete-side-effect.service';

const createRecordingDb = (
  executedQueries: CompiledQuery[],
  options?: {
    probeRows?: Array<Record<string, unknown>>;
    failSqlContaining?: string;
  }
) => {
  class RecordingDriver extends DummyDriver {
    override async acquireConnection(): Promise<DatabaseConnection> {
      const connection = await super.acquireConnection();
      return {
        executeQuery: async <R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> => {
          executedQueries.push(compiledQuery);
          if (options?.failSqlContaining && compiledQuery.sql.includes(options.failSqlContaining)) {
            throw new Error(`boom: ${options.failSqlContaining}`);
          }
          if (compiledQuery.sql.includes('to_regclass')) {
            return {
              rows: (options?.probeRows ?? [
                {
                  attachments_table: 'attachments_table',
                  record_history: 'record_history',
                  table_trash: 'table_trash',
                  record_trash: 'record_trash',
                },
              ]) as R[],
            };
          }
          return { rows: [] as R[] };
        },
        streamQuery: <R>(compiledQuery: CompiledQuery, chunkSize?: number) =>
          connection.streamQuery<R>(compiledQuery, chunkSize),
      };
    }
  }

  return new Kysely<IV2TableDeleteSideEffectDb>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new RecordingDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
};

const event = TableDeleted.create({
  baseId: BaseId.create('bse0000000000000001')._unsafeUnwrap(),
  tableId: TableId.create('tbl0000000000000001')._unsafeUnwrap(),
  tableName: TableName.create('Orders')._unsafeUnwrap(),
  fieldIds: [FieldId.create('fld0000000000000001')._unsafeUnwrap()],
  viewIds: [],
});

const txContext = (txDb: unknown) => ({
  kind: 'unitOfWorkTransaction' as const,
  db: txDb,
});

describe('V2TableDeleteSideEffectService', () => {
  it('registers the cleanup projection with meta and data v2 Kysely connections', () => {
    const metaDb = createRecordingDb([]);
    const dataDb = createRecordingDb([]);
    const container = {
      resolve: vi.fn((token: symbol) => (token === v2MetaDbTokens.db ? metaDb : dataDb)),
      registerInstance: vi.fn(),
    };

    new V2TableDeleteSideEffectService().registerProjections(container as never);

    expect(container.resolve).toHaveBeenCalledWith(v2MetaDbTokens.db);
    expect(container.resolve).toHaveBeenCalledWith(v2DataDbTokens.db);
    expect(container.registerInstance).toHaveBeenCalledWith(
      V2TableDeletedResourceCleanupProjection,
      expect.any(V2TableDeletedResourceCleanupProjection)
    );
  });

  it('deletes host metadata and sidecar rows inside the active meta and data transactions', async () => {
    const sharedQueries: CompiledQuery[] = [];
    const sharedTx = createRecordingDb(sharedQueries);
    const metaDb = createRecordingDb([]);
    const projection = new V2TableDeletedResourceCleanupProjection(metaDb, metaDb);

    const result = await projection.handle(
      {
        transactions: {
          meta: { ...txContext(sharedTx), scope: 'meta' },
          data: { ...txContext(sharedTx), scope: 'data' },
        },
      } as never,
      event
    );

    expect(result.isOk()).toBe(true);
    const sqlStatements = sharedQueries.map((query) => query.sql);
    expect(sqlStatements).toContainEqual(
      expect.stringMatching(
        /^delete from "task_reference" where \(?"from_field_id" in \(select "id" from "field" where "table_id" = \$1\) or "to_field_id" in \(select "id" from "field" where "table_id" = \$2\) or "from_field_id" in \(\$3\) or "to_field_id" in \(\$4\)\)?$/
      )
    );
    expect(sqlStatements).toContain('delete from "task" where strpos("snapshot", $1) > 0');
    expect(sqlStatements).toContain('delete from "comment" where "table_id" = $1');
    expect(sqlStatements).toContain('delete from "comment_subscription" where "table_id" = $1');
    expect(sqlStatements).toContain('delete from "attachments_table" where "table_id" = $1');
    expect(sqlStatements).toContain('delete from "ops" where "collection" = $1');
    expect(sqlStatements).toContain('delete from "ops" where "collection" = $1 and "doc_id" = $2');
    expect(sqlStatements).toContain('delete from "record_history" where "table_id" = $1');
    expect(sqlStatements).toContain('delete from "table_trash" where "table_id" = $1');
    expect(sqlStatements).toContain('delete from "record_trash" where "table_id" = $1');
    // Same transaction shares meta and data, so attachments_table is deleted once.
    expect(
      sqlStatements.filter((statement) => statement.includes('delete from "attachments_table"'))
    ).toHaveLength(1);
  });

  it('cleans split data-db attachment refs and skips absent sidecar relations', async () => {
    const metaQueries: CompiledQuery[] = [];
    const dataQueries: CompiledQuery[] = [];
    const metaTx = createRecordingDb(metaQueries);
    const dataTx = createRecordingDb(dataQueries, {
      probeRows: [
        {
          attachments_table: 'tenant.attachments_table',
          record_history: null,
          table_trash: null,
          record_trash: 'tenant.record_trash',
        },
      ],
    });
    const projection = new V2TableDeletedResourceCleanupProjection(metaTx, dataTx);

    const result = await projection.handle(
      {
        transactions: {
          meta: { ...txContext(metaTx), scope: 'meta' },
          data: { ...txContext(dataTx), scope: 'data' },
        },
      } as never,
      event
    );

    expect(result.isOk()).toBe(true);
    const dataStatements = dataQueries.map((query) => query.sql);
    expect(dataStatements).toContain('delete from "attachments_table" where "table_id" = $1');
    expect(dataStatements).toContain('delete from "record_trash" where "table_id" = $1');
    expect(dataStatements).not.toContain('delete from "record_history" where "table_id" = $1');
    expect(dataStatements).not.toContain('delete from "table_trash" where "table_id" = $1');
  });

  it('cleans soft-deleted task_reference fields when event.fieldIds is empty and probes schema-scoped sidecar relations', async () => {
    const metaQueries: CompiledQuery[] = [];
    const dataQueries: CompiledQuery[] = [];
    const metaTx = createRecordingDb(metaQueries);
    const dataTx = createRecordingDb(dataQueries).withSchema('bse_custom');
    const projection = new V2TableDeletedResourceCleanupProjection(
      metaTx,
      dataTx as unknown as Kysely<IV2TableDeleteSideEffectDb>
    );
    const emptyFieldsEvent = TableDeleted.create({
      baseId: BaseId.create('bse0000000000000001')._unsafeUnwrap(),
      tableId: TableId.create('tbl0000000000000001')._unsafeUnwrap(),
      tableName: TableName.create('Orders')._unsafeUnwrap(),
      fieldIds: [],
      viewIds: [],
    });

    const result = await projection.handle(
      {
        transactions: {
          meta: { ...txContext(metaTx), scope: 'meta' },
          data: { ...txContext(dataTx), scope: 'data' },
        },
      } as never,
      emptyFieldsEvent
    );

    expect(result.isOk()).toBe(true);
    const taskRefQuery = metaQueries.find((q) => q.sql.includes('delete from "task_reference"'));
    expect(taskRefQuery?.sql).toContain('select "id" from "field" where "table_id" = $1');
    const probeQuery = dataQueries.find((q) => q.sql.includes('to_regclass'));
    expect(probeQuery?.parameters).toEqual([
      '"bse_custom"."attachments_table"',
      '"bse_custom"."record_history"',
      '"bse_custom"."table_trash"',
      '"bse_custom"."record_trash"',
    ]);
  });

  it('returns an error so DeleteTableHandler aborts the purge when metadata cleanup fails', async () => {
    const metaDb = createRecordingDb([], { failSqlContaining: 'delete from "comment"' });
    const projection = new V2TableDeletedResourceCleanupProjection(metaDb, metaDb);

    const result = await projection.handle({} as never, event);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('delete from "comment"');
  });
});
