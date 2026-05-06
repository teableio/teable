import {
  ActorId,
  BaseId,
  DbFieldName,
  FieldId,
  FieldName,
  LinkFieldConfig,
  RecordId,
  Table,
  TableId,
  TableName,
  TableRecord,
  ok,
} from '@teable/v2-core';
import type { IHasher, ILogger, IRecordOrderCalculator } from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
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

import type {
  ComputedFieldUpdater,
  ComputedUpdatePlanner,
  IUpdateStrategy,
  IComputedUpdateOutbox,
} from '../computed';
import type { DynamicDB } from '../query-builder';
import { createNoopEventBus } from './__tests__/helpers/createNoopEventBus';
import { PostgresRecordMutationSnapshotCaptureService } from './PostgresRecordMutationSnapshotCaptureService';
import { PostgresTableRecordRepository } from './PostgresTableRecordRepository';

// =============================================================================
// Test utilities
// =============================================================================

type RowProvider = (compiledQuery: CompiledQuery) => unknown[];

type RecordingSessionState = {
  undoBatchId?: string;
};

class RecordingConnection implements DatabaseConnection {
  constructor(
    private readonly queries: CompiledQuery[],
    private readonly rowProvider?: RowProvider,
    private readonly sessionState: RecordingSessionState = {}
  ) {}

  async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    this.queries.push(compiledQuery);

    if (compiledQuery.sql.includes("set_config('teable.undo_batch_id'")) {
      const batchId = compiledQuery.parameters[0];
      this.sessionState.undoBatchId =
        typeof batchId === 'string' && batchId.length > 0 ? batchId : undefined;
      return {
        rows: [{ set_config: this.sessionState.undoBatchId ?? '' }] as R[],
      };
    }

    if (compiledQuery.sql.includes("current_setting('teable.undo_batch_id', true)")) {
      return {
        rows: [{ batch_id: this.sessionState.undoBatchId ?? null }] as R[],
      };
    }

    const rows = (this.rowProvider?.(compiledQuery) ?? []) as R[];
    return { rows };
  }

  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    yield { rows: [] };
  }
}

class RecordingDriver implements Driver {
  readonly queries: CompiledQuery[] = [];
  private readonly sessionState: RecordingSessionState = {};

  constructor(private readonly rowProvider?: RowProvider) {}

  async init(): Promise<void> {
    return undefined;
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    return new RecordingConnection(this.queries, this.rowProvider, this.sessionState);
  }

  async beginTransaction(): Promise<void> {
    return undefined;
  }
  async commitTransaction(): Promise<void> {
    return undefined;
  }
  async rollbackTransaction(): Promise<void> {
    return undefined;
  }
  async releaseConnection(): Promise<void> {
    return undefined;
  }
  async destroy(): Promise<void> {
    return undefined;
  }
  async savepoint(): Promise<void> {
    return undefined;
  }
  async rollbackToSavepoint(): Promise<void> {
    return undefined;
  }
  async releaseSavepoint(): Promise<void> {
    return undefined;
  }
}

const createRecordingDb = (rowProvider?: RowProvider) => {
  const defaultUndoLogRowProvider: RowProvider = (compiledQuery) => {
    if (compiledQuery.sql.includes('FROM information_schema.tables')) {
      return [{ exists: true }];
    }
    if (compiledQuery.sql.includes('FROM information_schema.columns')) {
      return [{ exists: true }];
    }
    if (compiledQuery.sql.includes('FROM pg_proc')) {
      return [{ exists: true }];
    }
    if (compiledQuery.sql.includes('FROM pg_trigger AS t')) {
      return [{ exists: true }];
    }
    if (compiledQuery.sql.includes('FROM "public"."__undo_log"')) {
      return [
        {
          record_id: RECORD_ID,
          operation: 'DELETE',
          old_row: {
            __id: RECORD_ID,
          },
          new_row: null,
        },
      ];
    }
    return [];
  };
  const driver = new RecordingDriver(
    rowProvider
      ? (compiledQuery) => {
          const providedRows = rowProvider(compiledQuery);
          return providedRows.length > 0 ? providedRows : defaultUndoLogRowProvider(compiledQuery);
        }
      : defaultUndoLogRowProvider
  );
  const db = new Kysely<DynamicDB>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (kysely) => new PostgresIntrospector(kysely),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  return { db, driver };
};

type MockLogger = ILogger & {
  debug: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
};

const createLogger = (): MockLogger => {
  const logger = {
    child: vi.fn(),
    scope: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as MockLogger;
  logger.child.mockReturnValue(logger);
  logger.scope.mockReturnValue(logger);
  return logger;
};

const createNoopComputedPlanner = (table: Table): ComputedUpdatePlanner => {
  return {
    plan: async () =>
      ok({
        baseId: table.baseId(),
        seedTableId: table.id(),
        seedRecordIds: [],
        extraSeedRecords: [],
        steps: [],
        edges: [],
        estimatedComplexity: 0,
        changeType: 'delete',
      }),
    planStage: async () =>
      ok({
        baseId: table.baseId(),
        seedTableId: table.id(),
        seedRecordIds: [],
        extraSeedRecords: [],
        steps: [],
        edges: [],
        estimatedComplexity: 0,
        changeType: 'delete',
      }),
    resolveBeforeImageRequirements: async () =>
      ok({
        needsBeforeImage: false,
        requiredFieldIds: [],
      }),
  } as unknown as ComputedUpdatePlanner;
};

const createNoopStrategy = (): IUpdateStrategy => {
  return {
    mode: 'sync',
    name: 'noop',
    execute: async () => ok(undefined),
    scheduleDispatch: () => undefined,
  };
};

const createNoopOutbox = (): IComputedUpdateOutbox => {
  return {
    enqueueOrMerge: async () => ok({ taskId: 'test', merged: false }),
    enqueueSeedTask: async () => ok({ taskId: 'test', merged: false }),
    enqueueFieldBackfill: async () => ok({ taskId: 'test', merged: false }),
    claimBatch: async () => ok([]),
    claimById: async () => ok(null),
    renewLease: async () => ok([]),
    markDone: async () => ok(true),
    markFailed: async () => ok(true),
  };
};

const createNoopHasher = (): IHasher => {
  return {
    sha256: () => 'test-hash',
  };
};

const createNoopRecordOrderCalculator = (): IRecordOrderCalculator => {
  return {
    calculateOrders: async () => ok([]),
  };
};

const createRepository = (
  db: Kysely<DynamicDB>,
  table: Table,
  computedUpdatePlanner: ComputedUpdatePlanner = createNoopComputedPlanner(table),
  logger: MockLogger = createLogger()
) => {
  const computedFieldUpdater = {} as ComputedFieldUpdater;
  const computedUpdateStrategy = createNoopStrategy();
  const computedUpdateOutbox = createNoopOutbox();
  const hasher = createNoopHasher();

  return new PostgresTableRecordRepository(
    db as unknown as Kysely<V1TeableDatabase>,
    logger,
    createNoopRecordOrderCalculator(),
    computedUpdatePlanner,
    computedFieldUpdater,
    computedUpdateStrategy,
    computedUpdateOutbox,
    new PostgresRecordMutationSnapshotCaptureService(
      db as unknown as Kysely<V1TeableDatabase>,
      logger
    ),
    createNoopEventBus(),
    hasher
  );
};

const createMissingTableExistsRowProvider = (
  schemaName: string,
  tableName: string
): RowProvider => {
  return (compiledQuery) => {
    if (
      compiledQuery.sql.includes('FROM information_schema.tables') &&
      compiledQuery.parameters[0] === schemaName &&
      compiledQuery.parameters[1] === tableName
    ) {
      return [{ exists: false }];
    }
    return [];
  };
};

const isUndoCaptureQuery = (query: CompiledQuery) => {
  const text = query.sql;
  return (
    text.includes('teable_undo_capture_') ||
    text.includes('"public"."__undo_log"') ||
    text.includes("table_name = '__undo_log'") ||
    text.includes('__teable_capture_undo_row') ||
    text.includes('FROM pg_trigger AS t') ||
    text.includes('"__teable_undo_capture"') ||
    text.includes('teable.undo_batch_id')
  );
};

const toSnapshot = (queries: ReadonlyArray<CompiledQuery>) =>
  queries
    .filter((query) => !isUndoCaptureQuery(query))
    .map((query) => ({ sql: query.sql, parameters: query.parameters }));

const composeRowProviders =
  (...providers: RowProvider[]): RowProvider =>
  (compiledQuery) => {
    for (const provider of providers) {
      const rows = provider(compiledQuery);
      if (rows.length > 0) {
        return rows;
      }
    }
    return [];
  };

const createRecordIdRowProvider = (tableName: string, recordIds: string[]): RowProvider => {
  const target = `from ${tableName}`;
  return (compiledQuery) => {
    if (compiledQuery.sql.includes('select *') && compiledQuery.sql.includes(target)) {
      return recordIds.map((recordId) => ({
        __id: recordId,
        record_id: recordId,
      }));
    }
    if (
      compiledQuery.sql.includes('select "__id" as "record_id"') &&
      compiledQuery.sql.includes(target)
    ) {
      return recordIds.map((recordId) => ({ record_id: recordId }));
    }
    return [];
  };
};

const createUndoLogRowProvider = (
  rows: ReadonlyArray<{
    record_id: string;
    operation?: string;
    old_row: Record<string, unknown>;
    new_row?: Record<string, unknown> | null;
  }>
): RowProvider => {
  return (compiledQuery) => {
    if (compiledQuery.sql.includes('FROM "public"."__undo_log"')) {
      return [...rows];
    }
    return [];
  };
};

const createSnapshotRowProvider = (
  tableName: string,
  rows: ReadonlyArray<Record<string, unknown>>
): RowProvider => {
  const target = `from ${tableName}`;
  return (compiledQuery) => {
    if (compiledQuery.sql.includes(target) && compiledQuery.sql.includes('select "__id"')) {
      return [...rows];
    }
    return [];
  };
};

// Fixed IDs for stable snapshots
const BASE_ID = `bse${'a'.repeat(16)}`;
const TABLE_ID = `tbl${'b'.repeat(16)}`;
const FOREIGN_TABLE_ID = `tbl${'c'.repeat(16)}`;
const LOOKUP_FIELD_ID = `fld${'d'.repeat(16)}`;
const LINK_FIELD_ID = `fld${'e'.repeat(16)}`;
const SYMMETRIC_FIELD_ID = `fld${'f'.repeat(16)}`;
const NAME_FIELD_ID = `fld${'g'.repeat(16)}`;
const RECORD_ID = `rec${'h'.repeat(16)}`;
const RECORD_ID_B = `rec${'i'.repeat(16)}`;
const ACTOR_ID = 'usr_test';

// =============================================================================
// Tests
// =============================================================================

describe('PostgresTableRecordRepository.deleteMany', () => {
  it('clears oneMany foreign key before delete', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
    const tableId = TableId.create(TABLE_ID)._unsafeUnwrap();
    const foreignTableId = TableId.create(FOREIGN_TABLE_ID)._unsafeUnwrap();
    const lookupFieldId = FieldId.create(LOOKUP_FIELD_ID)._unsafeUnwrap();
    const linkFieldId = FieldId.create(LINK_FIELD_ID)._unsafeUnwrap();
    const symmetricFieldId = FieldId.create(SYMMETRIC_FIELD_ID)._unsafeUnwrap();
    const nameFieldId = FieldId.create(NAME_FIELD_ID)._unsafeUnwrap();
    const recordId = RecordId.create(RECORD_ID)._unsafeUnwrap();
    const actorId = ActorId.create(ACTOR_ID)._unsafeUnwrap();

    const linkConfig = LinkFieldConfig.create({
      relationship: 'oneMany',
      foreignTableId: foreignTableId.toString(),
      lookupFieldId: lookupFieldId.toString(),
      symmetricFieldId: symmetricFieldId.toString(),
    })._unsafeUnwrap();

    const builder = Table.builder()
      .withId(tableId)
      .withBaseId(baseId)
      .withName(TableName.create('DeleteTable')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(nameFieldId)
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    builder
      .field()
      .link()
      .withId(linkFieldId)
      .withName(FieldName.create('Links')._unsafeUnwrap())
      .withConfig(linkConfig)
      .done();
    builder.view().defaultGrid().done();

    const table = builder.build()._unsafeUnwrap();

    const specBuilder = TableRecord.specs('or');
    specBuilder.recordId(recordId);
    const deleteSpec = specBuilder.build()._unsafeUnwrap();

    const tableName = `"bse${'a'.repeat(16)}"."tbl${'b'.repeat(16)}"`;
    const rowProvider = createRecordIdRowProvider(tableName, [recordId.toString()]);

    const { db, driver } = createRecordingDb(rowProvider);
    const repo = createRepository(db, table);

    const result = await repo.deleteMany({ actorId }, table, deleteSpec);
    expect(result.isOk()).toBe(true);

    expect(toSnapshot(driver.queries)).toMatchInlineSnapshot(`
      [
        {
          "parameters": [
            "rechhhhhhhhhhhhhhhh",
          ],
          "sql": "select "__id" as "record_id" from "bseaaaaaaaaaaaaaaaa"."tblbbbbbbbbbbbbbbbb" where "__id" = $1",
        },
        {
          "parameters": [
            "bseaaaaaaaaaaaaaaaa",
            "tblcccccccccccccccc",
          ],
          "sql": "
          SELECT EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = $1
            AND table_name = $2
          ) AS exists
        ",
        },
        {
          "parameters": [
            "rechhhhhhhhhhhhhhhh",
          ],
          "sql": "select "__fk_fldffffffffffffffff" as "self_key", "__id" as "foreign_key" from "bseaaaaaaaaaaaaaaaa"."tblcccccccccccccccc" where "__fk_fldffffffffffffffff" in ($1)",
        },
        {
          "parameters": [
            "bseaaaaaaaaaaaaaaaa",
            "link",
            "tblbbbbbbbbbbbbbbbb",
          ],
          "sql": "select "field"."id" as "field_id", "field"."table_id" as "source_table_id", "field"."options" as "options" from "field" inner join "table_meta" on "table_meta"."id" = "field"."table_id" where "table_meta"."base_id" = $1 and "field"."type" = $2 and "field"."deleted_time" is null and "field"."is_lookup" is null and (field.options::json->>'foreignTableId')::text = $3",
        },
        {
          "parameters": [
            "bseaaaaaaaaaaaaaaaa",
            "tblcccccccccccccccc",
          ],
          "sql": "
          SELECT EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = $1
            AND table_name = $2
          ) AS exists
        ",
        },
        {
          "parameters": [
            null,
            null,
            "rechhhhhhhhhhhhhhhh",
          ],
          "sql": "update "bseaaaaaaaaaaaaaaaa"."tblcccccccccccccccc" set "__fk_fldffffffffffffffff" = $1, "__fk_fldffffffffffffffff_order" = $2 where "__fk_fldffffffffffffffff" in ($3)",
        },
        {
          "parameters": [
            "rechhhhhhhhhhhhhhhh",
          ],
          "sql": "delete from "bseaaaaaaaaaaaaaaaa"."tblbbbbbbbbbbbbbbbb" where "__id" = $1",
        },
        {
          "parameters": [
            "usr_test",
            "tblbbbbbbbbbbbbbbbb",
          ],
          "sql": "update "public"."table_meta" set "last_modified_time" = CASE
                WHEN "last_modified_time" IS NULL THEN CURRENT_TIMESTAMP
                ELSE GREATEST(CURRENT_TIMESTAMP, "last_modified_time" + interval '1 millisecond')
              END, "last_modified_by" = $1 where "id" = $2",
        },
      ]
    `);
    vi.useRealTimers();
  });

  it('clears junction links before delete', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
    const tableId = TableId.create(TABLE_ID)._unsafeUnwrap();
    const foreignTableId = TableId.create(FOREIGN_TABLE_ID)._unsafeUnwrap();
    const lookupFieldId = FieldId.create(LOOKUP_FIELD_ID)._unsafeUnwrap();
    const linkFieldId = FieldId.create(LINK_FIELD_ID)._unsafeUnwrap();
    const symmetricFieldId = FieldId.create(SYMMETRIC_FIELD_ID)._unsafeUnwrap();
    const nameFieldId = FieldId.create(NAME_FIELD_ID)._unsafeUnwrap();
    const recordId = RecordId.create(RECORD_ID)._unsafeUnwrap();
    const recordIdB = RecordId.create(RECORD_ID_B)._unsafeUnwrap();
    const actorId = ActorId.create(ACTOR_ID)._unsafeUnwrap();

    const linkConfig = LinkFieldConfig.create({
      relationship: 'manyMany',
      foreignTableId: foreignTableId.toString(),
      lookupFieldId: lookupFieldId.toString(),
      symmetricFieldId: symmetricFieldId.toString(),
    })._unsafeUnwrap();

    const builder = Table.builder()
      .withId(tableId)
      .withBaseId(baseId)
      .withName(TableName.create('DeleteTable')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(nameFieldId)
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    builder
      .field()
      .link()
      .withId(linkFieldId)
      .withName(FieldName.create('Links')._unsafeUnwrap())
      .withConfig(linkConfig)
      .done();
    builder.view().defaultGrid().done();

    const table = builder.build()._unsafeUnwrap();

    const specBuilder = TableRecord.specs('or');
    specBuilder.recordId(recordId).recordId(recordIdB);
    const deleteSpec = specBuilder.build()._unsafeUnwrap();

    const tableName = `"bse${'a'.repeat(16)}"."tbl${'b'.repeat(16)}"`;
    const rowProvider = composeRowProviders(
      createRecordIdRowProvider(tableName, [recordId.toString(), recordIdB.toString()]),
      createUndoLogRowProvider([
        {
          record_id: recordId.toString(),
          old_row: {
            __id: recordId.toString(),
          },
        },
        {
          record_id: recordIdB.toString(),
          old_row: {
            __id: recordIdB.toString(),
          },
        },
      ])
    );

    const { db, driver } = createRecordingDb(rowProvider);
    const repo = createRepository(db, table);

    const result = await repo.deleteMany({ actorId }, table, deleteSpec);
    expect(result.isOk()).toBe(true);

    expect(toSnapshot(driver.queries)).toMatchInlineSnapshot(`
      [
        {
          "parameters": [
            "rechhhhhhhhhhhhhhhh",
            "reciiiiiiiiiiiiiiii",
          ],
          "sql": "select "__id" as "record_id" from "bseaaaaaaaaaaaaaaaa"."tblbbbbbbbbbbbbbbbb" where ("__id" = $1) or ("__id" = $2)",
        },
        {
          "parameters": [
            "bseaaaaaaaaaaaaaaaa",
            "junction_fldeeeeeeeeeeeeeeee_fldffffffffffffffff",
          ],
          "sql": "
          SELECT EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = $1
            AND table_name = $2
          ) AS exists
        ",
        },
        {
          "parameters": [
            "rechhhhhhhhhhhhhhhh",
            "reciiiiiiiiiiiiiiii",
          ],
          "sql": "select "__fk_fldffffffffffffffff" as "self_key", "__fk_fldeeeeeeeeeeeeeeee" as "foreign_key" from "bseaaaaaaaaaaaaaaaa"."junction_fldeeeeeeeeeeeeeeee_fldffffffffffffffff" where "__fk_fldffffffffffffffff" in ($1, $2)",
        },
        {
          "parameters": [
            "bseaaaaaaaaaaaaaaaa",
            "link",
            "tblbbbbbbbbbbbbbbbb",
          ],
          "sql": "select "field"."id" as "field_id", "field"."table_id" as "source_table_id", "field"."options" as "options" from "field" inner join "table_meta" on "table_meta"."id" = "field"."table_id" where "table_meta"."base_id" = $1 and "field"."type" = $2 and "field"."deleted_time" is null and "field"."is_lookup" is null and (field.options::json->>'foreignTableId')::text = $3",
        },
        {
          "parameters": [
            "bseaaaaaaaaaaaaaaaa",
            "junction_fldeeeeeeeeeeeeeeee_fldffffffffffffffff",
          ],
          "sql": "
          SELECT EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = $1
            AND table_name = $2
          ) AS exists
        ",
        },
        {
          "parameters": [
            "rechhhhhhhhhhhhhhhh",
            "reciiiiiiiiiiiiiiii",
          ],
          "sql": "delete from "bseaaaaaaaaaaaaaaaa"."junction_fldeeeeeeeeeeeeeeee_fldffffffffffffffff" where "__fk_fldffffffffffffffff" in ($1, $2)",
        },
        {
          "parameters": [
            "rechhhhhhhhhhhhhhhh",
            "reciiiiiiiiiiiiiiii",
          ],
          "sql": "delete from "bseaaaaaaaaaaaaaaaa"."tblbbbbbbbbbbbbbbbb" where ("__id" = $1) or ("__id" = $2)",
        },
        {
          "parameters": [
            "usr_test",
            "tblbbbbbbbbbbbbbbbb",
          ],
          "sql": "update "public"."table_meta" set "last_modified_time" = CASE
                WHEN "last_modified_time" IS NULL THEN CURRENT_TIMESTAMP
                ELSE GREATEST(CURRENT_TIMESTAMP, "last_modified_time" + interval '1 millisecond')
              END, "last_modified_by" = $1 where "id" = $2",
        },
      ]
    `);
    vi.useRealTimers();
  });

  it('tolerates missing junction host table during delete and keeps warning logs', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

    const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
    const tableId = TableId.create(TABLE_ID)._unsafeUnwrap();
    const foreignTableId = TableId.create(FOREIGN_TABLE_ID)._unsafeUnwrap();
    const lookupFieldId = FieldId.create(LOOKUP_FIELD_ID)._unsafeUnwrap();
    const linkFieldId = FieldId.create(LINK_FIELD_ID)._unsafeUnwrap();
    const symmetricFieldId = FieldId.create(SYMMETRIC_FIELD_ID)._unsafeUnwrap();
    const nameFieldId = FieldId.create(NAME_FIELD_ID)._unsafeUnwrap();
    const recordId = RecordId.create(RECORD_ID)._unsafeUnwrap();
    const actorId = ActorId.create(ACTOR_ID)._unsafeUnwrap();

    const linkConfig = LinkFieldConfig.create({
      relationship: 'manyMany',
      foreignTableId: foreignTableId.toString(),
      lookupFieldId: lookupFieldId.toString(),
      symmetricFieldId: symmetricFieldId.toString(),
    })._unsafeUnwrap();

    const builder = Table.builder()
      .withId(tableId)
      .withBaseId(baseId)
      .withName(TableName.create('DeleteTable')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(nameFieldId)
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    builder
      .field()
      .link()
      .withId(linkFieldId)
      .withName(FieldName.create('Links')._unsafeUnwrap())
      .withConfig(linkConfig)
      .done();
    builder.view().defaultGrid().done();

    const table = builder.build()._unsafeUnwrap();

    const specBuilder = TableRecord.specs('or');
    specBuilder.recordId(recordId);
    const deleteSpec = specBuilder.build()._unsafeUnwrap();

    const tableName = `"bse${'a'.repeat(16)}"."tbl${'b'.repeat(16)}"`;
    const junctionTableName = `"bse${'a'.repeat(16)}"."junction_fldeeeeeeeeeeeeeeee_fldffffffffffffffff"`;
    const rowProvider = composeRowProviders(
      createMissingTableExistsRowProvider(
        `bse${'a'.repeat(16)}`,
        'junction_fldeeeeeeeeeeeeeeee_fldffffffffffffffff'
      ),
      createRecordIdRowProvider(tableName, [recordId.toString()]),
      createUndoLogRowProvider([
        {
          record_id: recordId.toString(),
          old_row: {
            __id: recordId.toString(),
          },
        },
      ])
    );

    const { db, driver } = createRecordingDb(rowProvider);
    const logger = createLogger();
    const repo = createRepository(db, table, createNoopComputedPlanner(table), logger);

    const result = await repo.deleteMany({ actorId }, table, deleteSpec);
    expect(result.isOk()).toBe(true);
    const snapshotSql = toSnapshot(driver.queries).map((query) => query.sql);
    expect(snapshotSql.some((sql) => sql.includes(`from ${junctionTableName}`))).toBe(false);
    expect(snapshotSql.some((sql) => sql.includes(`delete from ${junctionTableName}`))).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      'record:delete:missing_link_host_table',
      expect.objectContaining({
        phase: 'load-existing',
        fieldId: LINK_FIELD_ID,
        hostTableName: 'bseaaaaaaaaaaaaaaaa.junction_fldeeeeeeeeeeeeeeee_fldffffffffffffffff',
        operationType: 'junction-delete',
      })
    );
    expect(logger.warn).toHaveBeenCalledWith(
      'record:delete:missing_link_host_table',
      expect.objectContaining({
        phase: 'cleanup-outgoing',
        fieldId: LINK_FIELD_ID,
        hostTableName: 'bseaaaaaaaaaaaaaaaa.junction_fldeeeeeeeeeeeeeeee_fldffffffffffffffff',
        operationType: 'junction-delete',
      })
    );

    vi.useRealTimers();
  });

  it('tolerates missing foreign host table during delete and keeps warning logs', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

    const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
    const tableId = TableId.create(TABLE_ID)._unsafeUnwrap();
    const foreignTableId = TableId.create(FOREIGN_TABLE_ID)._unsafeUnwrap();
    const lookupFieldId = FieldId.create(LOOKUP_FIELD_ID)._unsafeUnwrap();
    const linkFieldId = FieldId.create(LINK_FIELD_ID)._unsafeUnwrap();
    const symmetricFieldId = FieldId.create(SYMMETRIC_FIELD_ID)._unsafeUnwrap();
    const nameFieldId = FieldId.create(NAME_FIELD_ID)._unsafeUnwrap();
    const recordId = RecordId.create(RECORD_ID)._unsafeUnwrap();
    const actorId = ActorId.create(ACTOR_ID)._unsafeUnwrap();

    const linkConfig = LinkFieldConfig.create({
      relationship: 'oneMany',
      foreignTableId: foreignTableId.toString(),
      lookupFieldId: lookupFieldId.toString(),
      symmetricFieldId: symmetricFieldId.toString(),
    })._unsafeUnwrap();

    const builder = Table.builder()
      .withId(tableId)
      .withBaseId(baseId)
      .withName(TableName.create('DeleteTable')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(nameFieldId)
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    builder
      .field()
      .link()
      .withId(linkFieldId)
      .withName(FieldName.create('Links')._unsafeUnwrap())
      .withConfig(linkConfig)
      .done();
    builder.view().defaultGrid().done();

    const table = builder.build()._unsafeUnwrap();

    const specBuilder = TableRecord.specs('or');
    specBuilder.recordId(recordId);
    const deleteSpec = specBuilder.build()._unsafeUnwrap();

    const tableName = `"bse${'a'.repeat(16)}"."tbl${'b'.repeat(16)}"`;
    const foreignHostTableName = `"bse${'a'.repeat(16)}"."tblcccccccccccccccc"`;
    const rowProvider = composeRowProviders(
      createMissingTableExistsRowProvider(`bse${'a'.repeat(16)}`, `tbl${'c'.repeat(16)}`),
      createRecordIdRowProvider(tableName, [recordId.toString()]),
      createUndoLogRowProvider([
        {
          record_id: recordId.toString(),
          old_row: {
            __id: recordId.toString(),
          },
        },
      ])
    );

    const { db, driver } = createRecordingDb(rowProvider);
    const logger = createLogger();
    const repo = createRepository(db, table, createNoopComputedPlanner(table), logger);

    const result = await repo.deleteMany({ actorId }, table, deleteSpec);
    expect(result.isOk()).toBe(true);
    const snapshotSql = toSnapshot(driver.queries).map((query) => query.sql);
    expect(snapshotSql.some((sql) => sql.includes(`from ${foreignHostTableName}`))).toBe(false);
    expect(snapshotSql.some((sql) => sql.includes(`update ${foreignHostTableName}`))).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      'record:delete:missing_link_host_table',
      expect.objectContaining({
        phase: 'load-existing',
        fieldId: LINK_FIELD_ID,
        hostTableName: 'bseaaaaaaaaaaaaaaaa.tblcccccccccccccccc',
        operationType: 'fk-nullify',
      })
    );
    expect(logger.warn).toHaveBeenCalledWith(
      'record:delete:missing_link_host_table',
      expect.objectContaining({
        phase: 'cleanup-outgoing',
        fieldId: LINK_FIELD_ID,
        hostTableName: 'bseaaaaaaaaaaaaaaaa.tblcccccccccccccccc',
        operationType: 'fk-nullify',
      })
    );

    vi.useRealTimers();
  });

  it('captures only required before-image columns for delete propagation', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

    const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
    const tableId = TableId.create(TABLE_ID)._unsafeUnwrap();
    const nameFieldId = FieldId.create(NAME_FIELD_ID)._unsafeUnwrap();
    const recordId = RecordId.create(RECORD_ID)._unsafeUnwrap();
    const actorId = ActorId.create(ACTOR_ID)._unsafeUnwrap();

    const builder = Table.builder()
      .withId(tableId)
      .withBaseId(baseId)
      .withName(TableName.create('DeleteTable')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(nameFieldId)
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    builder.view().defaultGrid().done();

    const table = builder.build()._unsafeUnwrap();
    table
      .getField((field) => field.id().equals(nameFieldId))
      ._unsafeUnwrap()
      .setDbFieldName(DbFieldName.rehydrate('col_name')._unsafeUnwrap())
      ._unsafeUnwrap();

    const specBuilder = TableRecord.specs('or');
    specBuilder.recordId(recordId);
    const deleteSpec = specBuilder.build()._unsafeUnwrap();

    const capturedPlanInputs: Array<Record<string, unknown>> = [];
    const mockPlan = {
      baseId: table.baseId(),
      seedTableId: table.id(),
      seedRecordIds: [recordId],
      extraSeedRecords: [],
      steps: [],
      edges: [],
      estimatedComplexity: 0,
      changeType: 'delete' as const,
    };
    const computedUpdatePlanner = {
      plan: async () => ok(mockPlan),
      planStage: async (input: Record<string, unknown>) => {
        capturedPlanInputs.push(input);
        return ok({
          ...mockPlan,
          beforeImageRecords: input.beforeImageRecords as never,
        });
      },
      resolveBeforeImageRequirements: async () =>
        ok({
          needsBeforeImage: true,
          requiredFieldIds: [nameFieldId],
        }),
    } as unknown as ComputedUpdatePlanner;

    const tableName = `"bse${'a'.repeat(16)}"."tbl${'b'.repeat(16)}"`;
    const { db, driver } = createRecordingDb(
      createSnapshotRowProvider(tableName, [
        {
          record_id: recordId.toString(),
          [`old_${nameFieldId.toString()}`]: 'Alice',
        },
      ])
    );
    const repo = createRepository(db, table, computedUpdatePlanner);

    const result = await repo.deleteMany({ actorId }, table, deleteSpec);
    expect(result.isOk()).toBe(true);

    expect(toSnapshot(driver.queries)).toMatchInlineSnapshot(`
      [
        {
          "parameters": [
            "rechhhhhhhhhhhhhhhh",
          ],
          "sql": "select "__id" as "record_id", "col_name" as "old_fldgggggggggggggggg" from "bseaaaaaaaaaaaaaaaa"."tblbbbbbbbbbbbbbbbb" where "__id" = $1",
        },
        {
          "parameters": [
            "bseaaaaaaaaaaaaaaaa",
            "link",
            "tblbbbbbbbbbbbbbbbb",
          ],
          "sql": "select "field"."id" as "field_id", "field"."table_id" as "source_table_id", "field"."options" as "options" from "field" inner join "table_meta" on "table_meta"."id" = "field"."table_id" where "table_meta"."base_id" = $1 and "field"."type" = $2 and "field"."deleted_time" is null and "field"."is_lookup" is null and (field.options::json->>'foreignTableId')::text = $3",
        },
        {
          "parameters": [
            "rechhhhhhhhhhhhhhhh",
          ],
          "sql": "delete from "bseaaaaaaaaaaaaaaaa"."tblbbbbbbbbbbbbbbbb" where "__id" = $1",
        },
        {
          "parameters": [
            "usr_test",
            "tblbbbbbbbbbbbbbbbb",
          ],
          "sql": "update "public"."table_meta" set "last_modified_time" = CASE
                WHEN "last_modified_time" IS NULL THEN CURRENT_TIMESTAMP
                ELSE GREATEST(CURRENT_TIMESTAMP, "last_modified_time" + interval '1 millisecond')
              END, "last_modified_by" = $1 where "id" = $2",
        },
      ]
    `);
    expect(capturedPlanInputs[0]?.beforeImageRecords).toEqual([
      {
        recordId,
        fieldValuesByDbName: {
          col_name: 'Alice',
        },
      },
    ]);

    vi.useRealTimers();
  });

  it('returns deleted record snapshots captured from the undo log', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

    const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
    const tableId = TableId.create(TABLE_ID)._unsafeUnwrap();
    const nameFieldId = FieldId.create(NAME_FIELD_ID)._unsafeUnwrap();
    const recordId = RecordId.create(RECORD_ID)._unsafeUnwrap();
    const actorId = ActorId.create(ACTOR_ID)._unsafeUnwrap();

    const builder = Table.builder()
      .withId(tableId)
      .withBaseId(baseId)
      .withName(TableName.create('DeleteTable')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(nameFieldId)
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    builder.view().defaultGrid().done();

    const table = builder.build()._unsafeUnwrap();
    table
      .getField((field) => field.id().equals(nameFieldId))
      ._unsafeUnwrap()
      .setDbFieldName(DbFieldName.rehydrate('col_name')._unsafeUnwrap())
      ._unsafeUnwrap();

    const specBuilder = TableRecord.specs('or');
    specBuilder.recordId(recordId);
    const deleteSpec = specBuilder.build()._unsafeUnwrap();

    const tableName = `"bse${'a'.repeat(16)}"."tbl${'b'.repeat(16)}"`;
    const { db } = createRecordingDb(
      composeRowProviders(
        createRecordIdRowProvider(tableName, [recordId.toString()]),
        createUndoLogRowProvider([
          {
            record_id: recordId.toString(),
            old_row: {
              __id: recordId.toString(),
              col_name: 'Alice',
            },
          },
        ])
      )
    );
    const repo = createRepository(db, table);

    const result = await repo.deleteMany({ actorId }, table, deleteSpec);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({
      deletedRecords: [
        expect.objectContaining({
          recordId: recordId.toString(),
          fields: {
            [NAME_FIELD_ID]: 'Alice',
          },
        }),
      ],
    });

    vi.useRealTimers();
  });

  it('returns Err when delete snapshot capture is incomplete', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

    const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
    const tableId = TableId.create(TABLE_ID)._unsafeUnwrap();
    const nameFieldId = FieldId.create(NAME_FIELD_ID)._unsafeUnwrap();
    const recordId = RecordId.create(RECORD_ID)._unsafeUnwrap();
    const recordIdB = RecordId.create(`rec${'z'.repeat(16)}`)._unsafeUnwrap();
    const actorId = ActorId.create(ACTOR_ID)._unsafeUnwrap();

    const builder = Table.builder()
      .withId(tableId)
      .withBaseId(baseId)
      .withName(TableName.create('DeleteTable')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(nameFieldId)
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    builder.view().defaultGrid().done();

    const table = builder.build()._unsafeUnwrap();
    table
      .getField((field) => field.id().equals(nameFieldId))
      ._unsafeUnwrap()
      .setDbFieldName(DbFieldName.rehydrate('col_name')._unsafeUnwrap())
      ._unsafeUnwrap();

    const specBuilder = TableRecord.specs('or');
    specBuilder.recordId(recordId);
    specBuilder.recordId(recordIdB);
    const deleteSpec = specBuilder.build()._unsafeUnwrap();

    const tableName = `"bse${'a'.repeat(16)}"."tbl${'b'.repeat(16)}"`;
    const { db } = createRecordingDb(
      composeRowProviders(
        createRecordIdRowProvider(tableName, [recordId.toString(), recordIdB.toString()]),
        createUndoLogRowProvider([
          {
            record_id: recordId.toString(),
            old_row: {
              __id: recordId.toString(),
              col_name: 'Alice',
            },
          },
        ])
      )
    );
    const repo = createRepository(db, table);

    const result = await repo.deleteMany({ actorId }, table, deleteSpec);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain(
      'Failed to capture complete delete snapshots'
    );

    vi.useRealTimers();
  });
});
