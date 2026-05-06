import {
  ActorId,
  BaseId,
  DbFieldName,
  FieldId,
  FieldName,
  LinkFieldConfig,
  RecordByIdsSpec,
  RecordId,
  Table,
  TableRecord,
  TableId,
  TableName,
  ViewId,
  DefaultTableMapper,
  buildRecordConditionSpec,
  domainError,
  ok,
} from '@teable/v2-core';
import type {
  IHasher,
  ILogger,
  ISpecification,
  ITablePersistenceDTO,
  LinkField,
  IRecordOrderCalculator,
  ITableRecordConditionSpecVisitor,
} from '@teable/v2-core';
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
import { CellValueMutateVisitor } from '../visitors/CellValueMutateVisitor';
import { createNoopEventBus } from './__tests__/helpers/createNoopEventBus';
import { PostgresRecordMutationSnapshotCaptureService } from './PostgresRecordMutationSnapshotCaptureService';
import { PostgresTableRecordRepository } from './PostgresTableRecordRepository';

// =============================================================================
// Test utilities
// =============================================================================

type RowProvider = (compiledQuery: CompiledQuery) => unknown[];

const defaultRowsForQuery = (compiledQuery: CompiledQuery): unknown[] => {
  const sqlText = compiledQuery.sql.toLowerCase();
  if (
    sqlText.includes('returning') &&
    sqlText.includes('record_id') &&
    sqlText.includes('new_version')
  ) {
    const recordId = compiledQuery.sql.match(/\('([^']+)'/)?.[1] ?? `rec${'h'.repeat(16)}`;
    const row: Record<string, unknown> = { record_id: recordId, old_version: 1, new_version: 2 };
    for (const match of compiledQuery.sql.matchAll(/ AS "(old_[^"]+)"/g)) {
      row[match[1]!] = null;
    }
    return [row];
  }

  if (!sqlText.includes('returning') || !sqlText.includes(' as "changed_')) {
    return [];
  }

  const row: Record<string, unknown> = {};
  for (const match of compiledQuery.sql.matchAll(/ as "(changed_\d+)"/g)) {
    row[match[1]!] = null;
  }
  return [row];
};

class RecordingConnection implements DatabaseConnection {
  constructor(
    private readonly queries: CompiledQuery[],
    private readonly rowProvider?: RowProvider
  ) {}

  async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    this.queries.push(compiledQuery);
    const providedRows = this.rowProvider?.(compiledQuery);
    const rows = (
      providedRows && providedRows.length > 0 ? providedRows : defaultRowsForQuery(compiledQuery)
    ) as R[];
    return { rows };
  }

  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    yield { rows: [] };
  }
}

class RecordingDriver implements Driver {
  readonly queries: CompiledQuery[] = [];

  constructor(private readonly rowProvider?: RowProvider) {}

  async init(): Promise<void> {
    return undefined;
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    return new RecordingConnection(this.queries, this.rowProvider);
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
  let currentUndoBatchId: string | undefined;
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
    if (compiledQuery.sql.includes("set_config('teable.undo_batch_id'")) {
      const batchId = compiledQuery.parameters[0];
      currentUndoBatchId = typeof batchId === 'string' && batchId.length > 0 ? batchId : undefined;
      return [{ set_config: currentUndoBatchId ?? '' }];
    }
    if (compiledQuery.sql.includes("current_setting('teable.undo_batch_id', true)")) {
      return [{ batch_id: currentUndoBatchId ?? null }];
    }
    if (compiledQuery.sql.includes('FROM "public"."__undo_log"')) {
      return [
        {
          operation: 'UPDATE',
          record_id: RECORD_ID,
          old_row: {
            __id: RECORD_ID,
            __version: 1,
          },
          new_row: {
            __id: RECORD_ID,
            __version: 2,
          },
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

const createLogger = (): ILogger => {
  const logger: ILogger = {
    child: () => logger,
    scope: () => logger,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  return logger;
};

const createNoopComputedPlanner = (table: Table): ComputedUpdatePlanner => {
  const mockPlan = {
    baseId: table.baseId(),
    seedTableId: table.id(),
    seedRecordIds: [],
    extraSeedRecords: [],
    steps: [],
    edges: [],
    estimatedComplexity: 0,
    changeType: 'update',
  };
  return {
    plan: async () => ok(mockPlan),
    planStage: async () => ok(mockPlan),
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
  computedUpdatePlanner: ComputedUpdatePlanner = createNoopComputedPlanner(table)
) => {
  const logger = createLogger();
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

const hydrateLinkField = (params: {
  table: Table;
  fieldId: FieldId;
  baseId: BaseId;
  tableId: TableId;
}) => {
  // Link SQL generation expects persisted db config + db field name.
  const linkField = params.table
    .getField((field) => field.id().equals(params.fieldId))
    ._unsafeUnwrap() as LinkField;
  linkField.setDbFieldName(DbFieldName.rehydrate('col_links')._unsafeUnwrap())._unsafeUnwrap();
  linkField.ensureDbConfig({ baseId: params.baseId, hostTableId: params.tableId })._unsafeUnwrap();
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

const createSingleRowProvider = (tableName: string, row: Record<string, unknown>): RowProvider => {
  const target = `from ${tableName}`;
  return (compiledQuery) => {
    if (compiledQuery.sql.includes(target) && compiledQuery.sql.includes('select "__id"')) {
      return [row];
    }
    return [];
  };
};

const createUndoLogRowProvider = (
  rows: ReadonlyArray<{
    record_id: string;
    old_row: Record<string, unknown>;
    new_row?: Record<string, unknown>;
    operation?: 'INSERT' | 'UPDATE' | 'DELETE';
  }>
): RowProvider => {
  return (compiledQuery) => {
    if (compiledQuery.sql.includes('FROM "public"."__undo_log"')) {
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
const LINKED_RECORD_A = `rec${'i'.repeat(16)}`;
const LINKED_RECORD_B = `rec${'j'.repeat(16)}`;
const ACTOR_ID = 'usr_test';
const VIEW_ID = `viw${'k'.repeat(16)}`;

// =============================================================================
// Tests
// =============================================================================

describe('PostgresTableRecordRepository.updateOne', () => {
  it('rejects bulk update when the filter spec does not produce a where clause', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

    const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
    const tableId = TableId.create(TABLE_ID)._unsafeUnwrap();
    const textFieldId = FieldId.create(NAME_FIELD_ID)._unsafeUnwrap();
    const actorId = ActorId.create(ACTOR_ID)._unsafeUnwrap();

    const builder = Table.builder()
      .withId(tableId)
      .withBaseId(baseId)
      .withName(TableName.create('BulkUpdateTable')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(textFieldId)
      .withName(FieldName.create('Status')._unsafeUnwrap())
      .primary()
      .done();
    builder.view().defaultGrid().done();

    const table = builder.build()._unsafeUnwrap();
    table
      .getField((field) => field.id().equals(textFieldId))
      ._unsafeUnwrap()
      .setDbFieldName(DbFieldName.rehydrate('col_status')._unsafeUnwrap())
      ._unsafeUnwrap();

    const mutateSpec = table
      .updateRecord(
        RecordId.create(RECORD_ID)._unsafeUnwrap(),
        new Map([[NAME_FIELD_ID, 'inactive']])
      )
      ._unsafeUnwrap().mutateSpec;
    const emptySpec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor> = {
      isSatisfiedBy: () => true,
      mutate: (record) => ok(record),
      accept: () => ok(undefined as never),
    };

    const { db, driver } = createRecordingDb(
      createUndoLogRowProvider([
        {
          operation: 'UPDATE',
          record_id: RECORD_ID,
          old_row: {
            __id: RECORD_ID,
            __version: 1,
            col_name: 'Before',
          },
          new_row: {
            __id: RECORD_ID,
            __version: 2,
            col_name: 'Alice',
          },
        },
      ])
    );
    const repo = createRepository(db, table);

    const result = await repo.updateMany({ actorId }, table, emptySpec, mutateSpec);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('record.bulk_update.empty_filter');
    expect(driver.queries).toHaveLength(0);

    vi.useRealTimers();
  });

  it('generates bulk update SQL with database-pushed where matching', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

    const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
    const tableId = TableId.create(TABLE_ID)._unsafeUnwrap();
    const textFieldId = FieldId.create(NAME_FIELD_ID)._unsafeUnwrap();
    const numberFieldId = FieldId.create(`fld${'n'.repeat(16)}`)._unsafeUnwrap();
    const actorId = ActorId.create(ACTOR_ID)._unsafeUnwrap();

    const builder = Table.builder()
      .withId(tableId)
      .withBaseId(baseId)
      .withName(TableName.create('BulkUpdateTable')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(textFieldId)
      .withName(FieldName.create('Status')._unsafeUnwrap())
      .primary()
      .done();
    builder
      .field()
      .number()
      .withId(numberFieldId)
      .withName(FieldName.create('Amount')._unsafeUnwrap())
      .done();
    builder.view().defaultGrid().done();

    const table = builder.build()._unsafeUnwrap();
    table
      .getField((field) => field.id().equals(textFieldId))
      ._unsafeUnwrap()
      .setDbFieldName(DbFieldName.rehydrate('col_status')._unsafeUnwrap())
      ._unsafeUnwrap();
    table
      .getField((field) => field.id().equals(numberFieldId))
      ._unsafeUnwrap()
      .setDbFieldName(DbFieldName.rehydrate('col_amount')._unsafeUnwrap())
      ._unsafeUnwrap();

    const mutateSpec = table
      .updateRecord(
        RecordId.create(RECORD_ID)._unsafeUnwrap(),
        new Map([[NAME_FIELD_ID, 'inactive']])
      )
      ._unsafeUnwrap().mutateSpec;
    const filterSpec = buildRecordConditionSpec(table, {
      fieldId: numberFieldId.toString(),
      operator: 'isGreater',
      value: 5,
    })._unsafeUnwrap();

    const { db, driver } = createRecordingDb();
    const repo = createRepository(db, table);

    const result = await repo.updateMany({ actorId }, table, filterSpec, mutateSpec);
    expect(result.isOk()).toBe(true);

    expect(toSnapshot(driver.queries)).toMatchInlineSnapshot(`
      [
        {
          "parameters": [
            5,
            "2025-01-01T00:00:00.000Z",
            "usr_test",
            "inactive",
            "inactive",
          ],
          "sql": "with "matched" as (select "__id" as "matched_id", "__version" as "old_version", "col_status" as "old_fldgggggggggggggggg" from "bseaaaaaaaaaaaaaaaa"."tblbbbbbbbbbbbbbbbb" where "col_amount" > $1) update "bseaaaaaaaaaaaaaaaa"."tblbbbbbbbbbbbbbbbb" set "__last_modified_time" = $2, "__last_modified_by" = $3, "__version" = "__version" + 1, "col_status" = $4 from "matched" where "__id" = "matched"."matched_id" and ("col_status" IS DISTINCT FROM $5) returning "__id" as "record_id", "__version" as "new_version", "matched"."old_version" as "old_version", "matched"."old_fldgggggggggggggggg" as "old_fldgggggggggggggggg"",
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

  it('generates bulk update SQL for explicit record ids', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

    const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
    const tableId = TableId.create(TABLE_ID)._unsafeUnwrap();
    const textFieldId = FieldId.create(NAME_FIELD_ID)._unsafeUnwrap();
    const actorId = ActorId.create(ACTOR_ID)._unsafeUnwrap();
    const recordIdA = RecordId.create(`rec${'a'.repeat(16)}`)._unsafeUnwrap();
    const recordIdB = RecordId.create(`rec${'b'.repeat(16)}`)._unsafeUnwrap();

    const builder = Table.builder()
      .withId(tableId)
      .withBaseId(baseId)
      .withName(TableName.create('BulkUpdateByIdsTable')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(textFieldId)
      .withName(FieldName.create('Status')._unsafeUnwrap())
      .primary()
      .done();
    builder.view().defaultGrid().done();

    const table = builder.build()._unsafeUnwrap();
    table
      .getField((field) => field.id().equals(textFieldId))
      ._unsafeUnwrap()
      .setDbFieldName(DbFieldName.rehydrate('col_status')._unsafeUnwrap())
      ._unsafeUnwrap();

    const mutateSpec = table
      .updateRecord(
        RecordId.create(RECORD_ID)._unsafeUnwrap(),
        new Map([[NAME_FIELD_ID, 'inactive']])
      )
      ._unsafeUnwrap().mutateSpec;
    const targetSpec = RecordByIdsSpec.create([recordIdA, recordIdB]);

    const { db, driver } = createRecordingDb();
    const repo = createRepository(db, table);

    const result = await repo.updateMany({ actorId }, table, targetSpec, mutateSpec);
    expect(result.isOk()).toBe(true);

    expect(toSnapshot(driver.queries)).toMatchInlineSnapshot(`
      [
        {
          "parameters": [
            "recaaaaaaaaaaaaaaaa",
            "recbbbbbbbbbbbbbbbb",
            "2025-01-01T00:00:00.000Z",
            "usr_test",
            "inactive",
            "inactive",
          ],
          "sql": "with "matched" as (select "__id" as "matched_id", "__version" as "old_version", "col_status" as "old_fldgggggggggggggggg" from "bseaaaaaaaaaaaaaaaa"."tblbbbbbbbbbbbbbbbb" where "__id" in ($1, $2)) update "bseaaaaaaaaaaaaaaaa"."tblbbbbbbbbbbbbbbbb" set "__last_modified_time" = $3, "__last_modified_by" = $4, "__version" = "__version" + 1, "col_status" = $5 from "matched" where "__id" = "matched"."matched_id" and ("col_status" IS DISTINCT FROM $6) returning "__id" as "record_id", "__version" as "new_version", "matched"."old_version" as "old_version", "matched"."old_fldgggggggggggggggg" as "old_fldgggggggggggggggg"",
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

  it('generates update SQL for a non-link field', async () => {
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
      .withName(TableName.create('UpdateTable')._unsafeUnwrap());
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

    // Create fieldValues map for update
    const fieldValues = new Map<string, unknown>([[NAME_FIELD_ID, 'Alice']]);

    // Get mutation spec from table.updateRecord
    const updateRecordResult = table.updateRecord(recordId, fieldValues);
    expect(updateRecordResult.isOk()).toBe(true);
    const { mutateSpec } = updateRecordResult._unsafeUnwrap();

    const { db, driver } = createRecordingDb();
    const repo = createRepository(db, table);

    const result = await repo.updateOne({ actorId }, table, recordId, mutateSpec);
    expect(result.isOk()).toBe(true);

    expect(toSnapshot(driver.queries)).toMatchInlineSnapshot(`
      [
        {
          "parameters": [
            "2025-01-01T00:00:00.000Z",
            "usr_test",
            "Alice",
            "rechhhhhhhhhhhhhhhh",
            "Alice",
          ],
          "sql": "update "bseaaaaaaaaaaaaaaaa"."tblbbbbbbbbbbbbbbbb" set "__last_modified_time" = $1, "__last_modified_by" = $2, "__version" = "__version" + 1, "col_name" = $3 where "__id" = $4 and ("col_name" IS DISTINCT FROM $5) returning "col_name" as "changed_0"",
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

  it('returns update snapshots captured from the undo log', async () => {
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
      .withName(TableName.create('UpdateTable')._unsafeUnwrap());
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

    const mutateSpec = table
      .updateRecord(recordId, new Map([[NAME_FIELD_ID, 'Alice']]))
      ._unsafeUnwrap().mutateSpec;

    const { db } = createRecordingDb(
      createUndoLogRowProvider([
        {
          operation: 'UPDATE',
          record_id: recordId.toString(),
          old_row: {
            __id: recordId.toString(),
            __version: 4,
            col_name: 'Before',
          },
          new_row: {
            __id: recordId.toString(),
            __version: 5,
            col_name: 'Alice',
          },
        },
      ])
    );
    const repo = createRepository(db, table);

    const result = await repo.updateOne({ actorId }, table, recordId, mutateSpec);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().updateSnapshot).toEqual({
      previous: {
        recordId: recordId.toString(),
        fields: {
          [NAME_FIELD_ID]: 'Before',
        },
        version: 4,
      },
      current: {
        recordId: recordId.toString(),
        fields: {
          [NAME_FIELD_ID]: 'Alice',
        },
        version: 5,
      },
      oldVersion: 4,
      newVersion: 5,
    });

    vi.useRealTimers();
  });

  it('uses the last UPDATE undo row as the update snapshot after-image', async () => {
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
      .withName(TableName.create('UpdateTableCurrentRow')._unsafeUnwrap());
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

    const mutateSpec = table
      .updateRecord(recordId, new Map([[NAME_FIELD_ID, 'Alice']]))
      ._unsafeUnwrap().mutateSpec;

    const { db } = createRecordingDb(
      createUndoLogRowProvider([
        {
          operation: 'UPDATE',
          record_id: recordId.toString(),
          old_row: {
            __id: recordId.toString(),
            __version: 4,
            col_name: 'Before',
          },
          new_row: {
            __id: recordId.toString(),
            __version: 5,
            col_name: 'Alice',
          },
        },
        {
          operation: 'INSERT',
          record_id: recordId.toString(),
          old_row: null as never,
          new_row: {
            __id: recordId.toString(),
            __version: 99,
            col_name: 'Not The Update After Image',
          },
        },
      ])
    );
    const repo = createRepository(db, table);

    const result = await repo.updateOne({ actorId }, table, recordId, mutateSpec);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().updateSnapshot?.current).toEqual({
      recordId: recordId.toString(),
      fields: {
        [NAME_FIELD_ID]: 'Alice',
      },
      version: 5,
    });

    vi.useRealTimers();
  });

  it('returns Err when update snapshot capture is missing version metadata', async () => {
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
      .withName(TableName.create('UpdateTable')._unsafeUnwrap());
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

    const mutateSpec = table
      .updateRecord(recordId, new Map([[NAME_FIELD_ID, 'Alice']]))
      ._unsafeUnwrap().mutateSpec;

    const { db } = createRecordingDb(
      createUndoLogRowProvider([
        {
          operation: 'UPDATE',
          record_id: recordId.toString(),
          old_row: {
            __id: recordId.toString(),
            col_name: 'Before',
          },
          new_row: {
            __id: recordId.toString(),
            col_name: 'Alice',
          },
        },
      ])
    );
    const repo = createRepository(db, table);

    const result = await repo.updateOne({ actorId }, table, recordId, mutateSpec);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('missing __version');

    vi.useRealTimers();
  });

  it('reads only required before-image columns when conditional propagation needs old values', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

    const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
    const tableId = TableId.create(TABLE_ID)._unsafeUnwrap();
    const textFieldId = FieldId.create(NAME_FIELD_ID)._unsafeUnwrap();
    const numberFieldId = FieldId.create(`fld${'n'.repeat(16)}`)._unsafeUnwrap();
    const recordId = RecordId.create(RECORD_ID)._unsafeUnwrap();
    const actorId = ActorId.create(ACTOR_ID)._unsafeUnwrap();

    const builder = Table.builder()
      .withId(tableId)
      .withBaseId(baseId)
      .withName(TableName.create('UpdateTable')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(textFieldId)
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    builder
      .field()
      .number()
      .withId(numberFieldId)
      .withName(FieldName.create('Amount')._unsafeUnwrap())
      .done();
    builder.view().defaultGrid().done();

    const table = builder.build()._unsafeUnwrap();
    table
      .getField((field) => field.id().equals(textFieldId))
      ._unsafeUnwrap()
      .setDbFieldName(DbFieldName.rehydrate('col_name')._unsafeUnwrap())
      ._unsafeUnwrap();
    table
      .getField((field) => field.id().equals(numberFieldId))
      ._unsafeUnwrap()
      .setDbFieldName(DbFieldName.rehydrate('col_amount')._unsafeUnwrap())
      ._unsafeUnwrap();

    const mutateSpec = table
      .updateRecord(recordId, new Map([[NAME_FIELD_ID, 'Alice']]))
      ._unsafeUnwrap().mutateSpec;

    const capturedPlanInputs: Array<Record<string, unknown>> = [];
    const mockPlan = {
      baseId: table.baseId(),
      seedTableId: table.id(),
      seedRecordIds: [recordId],
      extraSeedRecords: [],
      steps: [],
      edges: [],
      estimatedComplexity: 0,
      changeType: 'update' as const,
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
          requiredFieldIds: [numberFieldId],
        }),
    } as unknown as ComputedUpdatePlanner;

    const tableName = `"bse${'a'.repeat(16)}"."tbl${'b'.repeat(16)}"`;
    const { db, driver } = createRecordingDb(
      createSingleRowProvider(tableName, {
        record_id: recordId.toString(),
        [`old_${numberFieldId.toString()}`]: 7,
      })
    );
    const repo = createRepository(db, table, computedUpdatePlanner);

    const result = await repo.updateOne({ actorId }, table, recordId, mutateSpec);
    expect(result.isOk()).toBe(true);

    expect(toSnapshot(driver.queries)).toMatchInlineSnapshot(`
      [
        {
          "parameters": [
            "rechhhhhhhhhhhhhhhh",
          ],
          "sql": "select "__id" as "record_id", "col_amount" as "old_fldnnnnnnnnnnnnnnnn" from "bseaaaaaaaaaaaaaaaa"."tblbbbbbbbbbbbbbbbb" where "__id" = $1",
        },
        {
          "parameters": [
            "2025-01-01T00:00:00.000Z",
            "usr_test",
            "Alice",
            "rechhhhhhhhhhhhhhhh",
            "Alice",
          ],
          "sql": "update "bseaaaaaaaaaaaaaaaa"."tblbbbbbbbbbbbbbbbb" set "__last_modified_time" = $1, "__last_modified_by" = $2, "__version" = "__version" + 1, "col_name" = $3 where "__id" = $4 and ("col_name" IS DISTINCT FROM $5) returning "col_name" as "changed_0"",
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
          col_amount: 7,
        },
      },
    ]);

    vi.useRealTimers();
  });

  it('uses returned update ids for updateManyStream computed planning when RETURNING rows are incomplete', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

    const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
    const tableId = TableId.create(TABLE_ID)._unsafeUnwrap();
    const textFieldId = FieldId.create(NAME_FIELD_ID)._unsafeUnwrap();
    const recordIdA = RecordId.create(RECORD_ID)._unsafeUnwrap();
    const recordIdB = RecordId.create(`rec${'z'.repeat(16)}`)._unsafeUnwrap();
    const actorId = ActorId.create(ACTOR_ID)._unsafeUnwrap();

    const builder = Table.builder()
      .withId(tableId)
      .withBaseId(baseId)
      .withName(TableName.create('UpdateManyStreamTable')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(textFieldId)
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    builder.view().defaultGrid().done();

    const table = builder.build()._unsafeUnwrap();
    table
      .getField((field) => field.id().equals(textFieldId))
      ._unsafeUnwrap()
      .setDbFieldName(DbFieldName.rehydrate('col_name')._unsafeUnwrap())
      ._unsafeUnwrap();

    const updateResultA = table
      .updateRecord(recordIdA, new Map([[NAME_FIELD_ID, 'Alice']]))
      ._unsafeUnwrap();
    const updateResultB = table
      .updateRecord(recordIdB, new Map([[NAME_FIELD_ID, 'Bob']]))
      ._unsafeUnwrap();

    const capturedPlanInputs: Array<Record<string, unknown>> = [];
    const computedUpdatePlanner = {
      plan: async () =>
        ok({
          baseId: table.baseId(),
          seedTableId: table.id(),
          seedRecordIds: [],
          extraSeedRecords: [],
          steps: [],
          edges: [],
          estimatedComplexity: 0,
          changeType: 'update' as const,
        }),
      planStage: async (input: Record<string, unknown>) => {
        capturedPlanInputs.push(input);
        return ok({
          baseId: table.baseId(),
          seedTableId: table.id(),
          seedRecordIds: input.seedRecordIds as RecordId[],
          extraSeedRecords: [],
          beforeImageRecords: [],
          changedFieldIds: input.changedFieldIds as FieldId[],
          steps: [],
          edges: [],
          estimatedComplexity: 0,
          changeType: 'update' as const,
        });
      },
      resolveBeforeImageRequirements: async () =>
        ok({
          needsBeforeImage: false,
          requiredFieldIds: [],
        }),
    } as unknown as ComputedUpdatePlanner;

    const tableName = `"bse${'a'.repeat(16)}"."tbl${'b'.repeat(16)}"`;
    const { db } = createRecordingDb((compiledQuery) => {
      if (
        compiledQuery.sql.includes(`UPDATE ${tableName} AS t`) &&
        compiledQuery.sql.includes('RETURNING')
      ) {
        return [
          {
            record_id: recordIdA.toString(),
            new_version: 2,
          },
        ];
      }
      return [];
    });
    const repo = createRepository(db, table, computedUpdatePlanner);

    function* batches() {
      yield ok([updateResultA, updateResultB]);
    }

    const result = await repo.updateManyStream({ actorId }, table, batches());
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().updatedRecords).toEqual([
      {
        recordId: recordIdA,
        oldVersion: 1,
        newVersion: 2,
        oldFieldValues: {},
      },
    ]);
    expect(capturedPlanInputs[0]?.seedRecordIds).toEqual([recordIdA]);

    vi.useRealTimers();
  });

  it('includes foreign extra seed records for updateManyStream link relation changes', async () => {
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
    const linkedRecordId = RecordId.create(LINKED_RECORD_A)._unsafeUnwrap();
    const actorId = ActorId.create(ACTOR_ID)._unsafeUnwrap();

    const linkConfig = LinkFieldConfig.create({
      relationship: 'oneOne',
      foreignTableId: foreignTableId.toString(),
      lookupFieldId: lookupFieldId.toString(),
      symmetricFieldId: symmetricFieldId.toString(),
      isOneWay: false,
    })._unsafeUnwrap();

    const builder = Table.builder()
      .withId(tableId)
      .withBaseId(baseId)
      .withName(TableName.create('BatchUpdateExtraSeedTable')._unsafeUnwrap());
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
      .withName(FieldName.create('Partner')._unsafeUnwrap())
      .withConfig(linkConfig)
      .done();
    builder.view().defaultGrid().done();

    const table = builder.build()._unsafeUnwrap();
    table
      .getField((field) => field.id().equals(nameFieldId))
      ._unsafeUnwrap()
      .setDbFieldName(DbFieldName.rehydrate('col_name')._unsafeUnwrap())
      ._unsafeUnwrap();
    hydrateLinkField({ table, fieldId: linkFieldId, baseId, tableId });

    const updateRecordResult = table.updateRecord(
      recordId,
      new Map<string, unknown>([[LINK_FIELD_ID, { id: LINKED_RECORD_A }]])
    );
    expect(updateRecordResult.isOk()).toBe(true);

    const capturedPlanInputs: Array<Record<string, unknown>> = [];
    const computedUpdatePlanner = {
      ...createNoopComputedPlanner(table),
      planStage: async (input: Record<string, unknown>) => {
        capturedPlanInputs.push(input);
        return ok({
          baseId: table.baseId(),
          seedTableId: table.id(),
          seedRecordIds: input.seedRecordIds as RecordId[],
          extraSeedRecords: input.extraSeedRecords as Array<{
            tableId: TableId;
            recordIds: RecordId[];
          }>,
          beforeImageRecords: [],
          changedFieldIds: input.changedFieldIds as FieldId[],
          steps: [],
          edges: [],
          estimatedComplexity: 0,
          changeType: 'update' as const,
        });
      },
      resolveBeforeImageRequirements: async () =>
        ok({
          needsBeforeImage: false,
          requiredFieldIds: [],
        }),
    } as unknown as ComputedUpdatePlanner;

    const tableName = `"bse${'a'.repeat(16)}"."tbl${'b'.repeat(16)}"`;
    const { db } = createRecordingDb((compiledQuery) => {
      if (
        compiledQuery.sql.includes(`UPDATE ${tableName} AS t`) &&
        compiledQuery.sql.includes('RETURNING')
      ) {
        return [
          {
            record_id: recordId.toString(),
            new_version: 2,
          },
        ];
      }
      return [];
    });
    const repo = createRepository(db, table, computedUpdatePlanner);

    function* batches() {
      yield ok([updateRecordResult._unsafeUnwrap()]);
    }

    const result = await repo.updateManyStream({ actorId }, table, batches());
    expect(result.isOk()).toBe(true);
    expect(capturedPlanInputs[0]?.seedRecordIds).toEqual([recordId]);
    expect(capturedPlanInputs[0]?.extraSeedRecords).toEqual([
      {
        tableId: foreignTableId,
        recordIds: [linkedRecordId],
      },
    ]);
    expect(capturedPlanInputs[0]?.impact).toEqual({
      valueFieldIds: [linkFieldId],
      linkFieldIds: [linkFieldId],
    });

    vi.useRealTimers();
  });

  it('generates link update SQL for manyMany links', async () => {
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
      .withName(TableName.create('LinkUpdateTable')._unsafeUnwrap());
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
    table
      .getField((field) => field.id().equals(nameFieldId))
      ._unsafeUnwrap()
      .setDbFieldName(DbFieldName.rehydrate('col_name')._unsafeUnwrap())
      ._unsafeUnwrap();
    hydrateLinkField({ table, fieldId: linkFieldId, baseId, tableId });

    // Create fieldValues map for update
    const fieldValues = new Map<string, unknown>([
      [LINK_FIELD_ID, [{ id: LINKED_RECORD_A }, { id: LINKED_RECORD_B }]],
    ]);

    // Get mutation spec from table.updateRecord
    const updateRecordResult = table.updateRecord(recordId, fieldValues);
    expect(updateRecordResult.isOk()).toBe(true);
    const { mutateSpec } = updateRecordResult._unsafeUnwrap();

    const { db, driver } = createRecordingDb();
    const repo = createRepository(db, table);

    const result = await repo.updateOne({ actorId }, table, recordId, mutateSpec);
    expect(result.isOk()).toBe(true);
    expect(toSnapshot(driver.queries)).toHaveLength(6);

    expect(toSnapshot(driver.queries)).toMatchInlineSnapshot(`
      [
        {
          "parameters": [
            "rechhhhhhhhhhhhhhhh",
          ],
          "sql": "select "__fk_fldeeeeeeeeeeeeeeee" as "record_id" from "bseaaaaaaaaaaaaaaaa"."junction_fldeeeeeeeeeeeeeeee_fldffffffffffffffff" where "__fk_fldffffffffffffffff" = $1 order by "__order" asc",
        },
        {
          "parameters": [
            "2025-01-01T00:00:00.000Z",
            "usr_test",
            "[{"id":"reciiiiiiiiiiiiiiii"},{"id":"recjjjjjjjjjjjjjjjj"}]",
            "rechhhhhhhhhhhhhhhh",
            "[{"id":"reciiiiiiiiiiiiiiii"},{"id":"recjjjjjjjjjjjjjjjj"}]",
          ],
          "sql": "update "bseaaaaaaaaaaaaaaaa"."tblbbbbbbbbbbbbbbbb" set "__last_modified_time" = $1, "__last_modified_by" = $2, "__version" = "__version" + 1, "col_links" = $3 where "__id" = $4 and ("col_links" IS DISTINCT FROM $5) returning "col_links" as "changed_0"",
        },
        {
          "parameters": [],
          "sql": "SELECT pg_advisory_xact_lock(('x' || substr(md5(k), 1, 16))::bit(64)::bigint)
              FROM unnest(ARRAY['v2:link:bseaaaaaaaaaaaaaaaa:tblcccccccccccccccc:reciiiiiiiiiiiiiiii','v2:link:bseaaaaaaaaaaaaaaaa:tblcccccccccccccccc:recjjjjjjjjjjjjjjjj']::text[]) AS k
              ORDER BY k",
        },
        {
          "parameters": [
            "rechhhhhhhhhhhhhhhh",
          ],
          "sql": "delete from "bseaaaaaaaaaaaaaaaa"."junction_fldeeeeeeeeeeeeeeee_fldffffffffffffffff" where "__fk_fldffffffffffffffff" = $1",
        },
        {
          "parameters": [
            "rechhhhhhhhhhhhhhhh",
            "reciiiiiiiiiiiiiiii",
            1,
            "rechhhhhhhhhhhhhhhh",
            "recjjjjjjjjjjjjjjjj",
            2,
          ],
          "sql": "insert into "bseaaaaaaaaaaaaaaaa"."junction_fldeeeeeeeeeeeeeeee_fldffffffffffffffff" ("__fk_fldffffffffffffffff", "__fk_fldeeeeeeeeeeeeeeee", "__order") values ($1, $2, $3), ($4, $5, $6)",
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

  it('generates link update SQL for oneMany links', async () => {
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
      .withName(TableName.create('LinkUpdateTable')._unsafeUnwrap());
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
    table
      .getField((field) => field.id().equals(nameFieldId))
      ._unsafeUnwrap()
      .setDbFieldName(DbFieldName.rehydrate('col_name')._unsafeUnwrap())
      ._unsafeUnwrap();
    hydrateLinkField({ table, fieldId: linkFieldId, baseId, tableId });

    // Create fieldValues map for update
    const fieldValues = new Map<string, unknown>([
      [LINK_FIELD_ID, [{ id: LINKED_RECORD_A }, { id: LINKED_RECORD_B }]],
    ]);

    // Get mutation spec from table.updateRecord
    const updateRecordResult = table.updateRecord(recordId, fieldValues);
    expect(updateRecordResult.isOk()).toBe(true);
    const { mutateSpec } = updateRecordResult._unsafeUnwrap();

    const { db, driver } = createRecordingDb();
    const repo = createRepository(db, table);

    const result = await repo.updateOne({ actorId }, table, recordId, mutateSpec);
    expect(result.isOk()).toBe(true);
    expect(toSnapshot(driver.queries)).toHaveLength(7);

    expect(toSnapshot(driver.queries)).toMatchInlineSnapshot(`
      [
        {
          "parameters": [
            "rechhhhhhhhhhhhhhhh",
          ],
          "sql": "select "__id" as "record_id" from "bseaaaaaaaaaaaaaaaa"."tblcccccccccccccccc" where "__fk_fldffffffffffffffff" = $1 order by "__fk_fldffffffffffffffff_order" asc",
        },
        {
          "parameters": [
            "reciiiiiiiiiiiiiiii",
            "recjjjjjjjjjjjjjjjj",
          ],
          "sql": "select "__id" as "record_id", "__fk_fldffffffffffffffff" as "linked_to" from "bseaaaaaaaaaaaaaaaa"."tblcccccccccccccccc" where "__id" in ($1, $2) and "__fk_fldffffffffffffffff" is not null",
        },
        {
          "parameters": [
            "2025-01-01T00:00:00.000Z",
            "usr_test",
            "[{"id":"reciiiiiiiiiiiiiiii"},{"id":"recjjjjjjjjjjjjjjjj"}]",
            "rechhhhhhhhhhhhhhhh",
            "[{"id":"reciiiiiiiiiiiiiiii"},{"id":"recjjjjjjjjjjjjjjjj"}]",
          ],
          "sql": "update "bseaaaaaaaaaaaaaaaa"."tblbbbbbbbbbbbbbbbb" set "__last_modified_time" = $1, "__last_modified_by" = $2, "__version" = "__version" + 1, "col_links" = $3 where "__id" = $4 and ("col_links" IS DISTINCT FROM $5) returning "col_links" as "changed_0"",
        },
        {
          "parameters": [],
          "sql": "SELECT pg_advisory_xact_lock(('x' || substr(md5(k), 1, 16))::bit(64)::bigint)
              FROM unnest(ARRAY['v2:link:bseaaaaaaaaaaaaaaaa:tblcccccccccccccccc:reciiiiiiiiiiiiiiii','v2:link:bseaaaaaaaaaaaaaaaa:tblcccccccccccccccc:recjjjjjjjjjjjjjjjj']::text[]) AS k
              ORDER BY k",
        },
        {
          "parameters": [
            null,
            null,
            "rechhhhhhhhhhhhhhhh",
          ],
          "sql": "update "bseaaaaaaaaaaaaaaaa"."tblcccccccccccccccc" set "__fk_fldffffffffffffffff" = $1, "__fk_fldffffffffffffffff_order" = $2 where "__fk_fldffffffffffffffff" = $3",
        },
        {
          "parameters": [
            "reciiiiiiiiiiiiiiii",
            "rechhhhhhhhhhhhhhhh",
            1,
            "recjjjjjjjjjjjjjjjj",
            "rechhhhhhhhhhhhhhhh",
            2,
          ],
          "sql": "update "bseaaaaaaaaaaaaaaaa"."tblcccccccccccccccc" as t set "__fk_fldffffffffffffffff" = "v"."record_id", "__fk_fldffffffffffffffff_order" = "v"."order_index"::integer from (values ($1, $2, $3), ($4, $5, $6)) as v(id, record_id, order_index) where "t"."__id" = "v"."id"",
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

  it('acquires advisory lock for oneOne link in updateManyStream', async () => {
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
      relationship: 'oneOne',
      foreignTableId: foreignTableId.toString(),
      lookupFieldId: lookupFieldId.toString(),
      symmetricFieldId: symmetricFieldId.toString(),
      isOneWay: false,
    })._unsafeUnwrap();

    const builder = Table.builder()
      .withId(tableId)
      .withBaseId(baseId)
      .withName(TableName.create('OneOneBatchUpdateTable')._unsafeUnwrap());
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
      .withName(FieldName.create('Partner')._unsafeUnwrap())
      .withConfig(linkConfig)
      .done();
    builder.view().defaultGrid().done();

    const table = builder.build()._unsafeUnwrap();
    table
      .getField((field) => field.id().equals(nameFieldId))
      ._unsafeUnwrap()
      .setDbFieldName(DbFieldName.rehydrate('col_name')._unsafeUnwrap())
      ._unsafeUnwrap();
    hydrateLinkField({ table, fieldId: linkFieldId, baseId, tableId });

    const fieldValues = new Map<string, unknown>([[LINK_FIELD_ID, { id: LINKED_RECORD_A }]]);
    const updateRecordResult = table.updateRecord(recordId, fieldValues);
    expect(updateRecordResult.isOk()).toBe(true);

    const { db, driver } = createRecordingDb();
    const repo = createRepository(db, table);

    function* batches() {
      yield ok([updateRecordResult._unsafeUnwrap()]);
    }

    const result = await repo.updateManyStream({ actorId }, table, batches());
    expect(result.isOk()).toBe(true);

    const lockQuery = driver.queries.find((query) => query.sql.includes('pg_advisory_xact_lock'));
    expect(lockQuery).toBeDefined();
    expect(lockQuery?.sql).toContain(`v2:link:${BASE_ID}:${FOREIGN_TABLE_ID}:${LINKED_RECORD_A}`);
    expect(lockQuery?.sql).toContain('ORDER BY k');

    vi.useRealTimers();
  });

  it('returns Err when the insert stream throws a domain error', async () => {
    const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
    const tableId = TableId.create(TABLE_ID)._unsafeUnwrap();
    const nameFieldId = FieldId.create(NAME_FIELD_ID)._unsafeUnwrap();
    const actorId = ActorId.create(ACTOR_ID)._unsafeUnwrap();

    const builder = Table.builder()
      .withId(tableId)
      .withBaseId(baseId)
      .withName(TableName.create('InsertStreamErrorTable')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(nameFieldId)
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    builder.view().defaultGrid().done();

    const table = builder.build()._unsafeUnwrap();
    const { db } = createRecordingDb();
    const repo = createRepository(db, table);

    const batches: AsyncIterable<ReadonlyArray<TableRecord>> = {
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            throw domainError.validation({ message: 'insert stream exploded' });
          },
        };
      },
    };

    const result = await repo.insertManyStream({ actorId }, table, batches);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toBe('insert stream exploded');
  });

  it('casts oneMany order column update to integer', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

    const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
    const tableId = TableId.create(TABLE_ID)._unsafeUnwrap();
    const foreignTableId = TableId.create(FOREIGN_TABLE_ID)._unsafeUnwrap();
    const lookupFieldId = FieldId.create(LOOKUP_FIELD_ID)._unsafeUnwrap();
    const linkFieldId = FieldId.create(LINK_FIELD_ID)._unsafeUnwrap();
    const symmetricFieldId = FieldId.create(SYMMETRIC_FIELD_ID)._unsafeUnwrap();
    const nameFieldId = FieldId.create(NAME_FIELD_ID)._unsafeUnwrap();
    const viewId = ViewId.create(VIEW_ID)._unsafeUnwrap();
    const recordId = RecordId.create(RECORD_ID)._unsafeUnwrap();
    const actorId = ActorId.create(ACTOR_ID)._unsafeUnwrap();

    const fkHostTableName = `${BASE_ID}.${FOREIGN_TABLE_ID}`;
    const selfKeyName = `__fk_${SYMMETRIC_FIELD_ID}`;
    const orderColumnName = `${selfKeyName}_order`;

    const dto: ITablePersistenceDTO = {
      id: tableId.toString(),
      baseId: baseId.toString(),
      name: 'OrderColumnUpdateTable',
      primaryFieldId: nameFieldId.toString(),
      fields: [
        {
          id: nameFieldId.toString(),
          name: 'Name',
          type: 'singleLineText',
          dbFieldName: 'col_name',
        },
        {
          id: linkFieldId.toString(),
          name: 'Links',
          type: 'link',
          dbFieldName: 'col_links',
          meta: { hasOrderColumn: true },
          options: {
            relationship: 'oneMany',
            foreignTableId: foreignTableId.toString(),
            lookupFieldId: lookupFieldId.toString(),
            fkHostTableName,
            selfKeyName,
            foreignKeyName: '__id',
            symmetricFieldId: symmetricFieldId.toString(),
          },
        },
      ],
      views: [
        {
          id: viewId.toString(),
          name: 'Grid',
          type: 'grid',
          columnMeta: {},
        },
      ],
    };

    const mapper = new DefaultTableMapper();
    const table = mapper.toDomain(dto)._unsafeUnwrap();

    const fieldValues = new Map<string, unknown>([
      [linkFieldId.toString(), [{ id: LINKED_RECORD_A }, { id: LINKED_RECORD_B }]],
    ]);

    const updateRecordResult = table.updateRecord(recordId, fieldValues);
    expect(updateRecordResult.isOk()).toBe(true);
    const { mutateSpec } = updateRecordResult._unsafeUnwrap();

    const { db } = createRecordingDb();
    const now = new Date().toISOString();

    const visitor = CellValueMutateVisitor.create(db, table, `${BASE_ID}.${TABLE_ID}`, {
      recordId: recordId.toString(),
      actorId: actorId.toString(),
      now,
    });

    const acceptResult = mutateSpec.accept(visitor);
    expect(acceptResult.isOk()).toBe(true);

    const statements = visitor.build()._unsafeUnwrap();
    const orderUpdate = statements.additionalStatements.find(
      (q) => q.sql.includes(orderColumnName) && q.sql.includes('order_index')
    );
    expect(orderUpdate).toBeDefined();
    expect(orderUpdate!.sql).toContain('::integer');

    vi.useRealTimers();
  });
});

// =============================================================================
// Tests: hybrid/async mode skips planStage in transaction
// =============================================================================

const createHybridRepository = (
  db: Kysely<DynamicDB>,
  table: Table,
  overrides: {
    computedUpdatePlanner?: ComputedUpdatePlanner;
    computedUpdateOutbox?: IComputedUpdateOutbox;
    computedUpdateStrategy?: IUpdateStrategy;
  } = {}
) => {
  const logger = createLogger();
  const computedFieldUpdater = {} as ComputedFieldUpdater;
  const computedUpdatePlanner = overrides.computedUpdatePlanner ?? createNoopComputedPlanner(table);
  const computedUpdateOutbox = overrides.computedUpdateOutbox ?? createNoopOutbox();
  const computedUpdateStrategy = overrides.computedUpdateStrategy ?? {
    mode: 'hybrid' as const,
    name: 'hybrid',
    execute: async () => ok(undefined),
    scheduleDispatch: vi.fn(),
  };
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

describe('PostgresTableRecordRepository hybrid/async computed update', () => {
  it('skips planStage and enqueues seed task directly in hybrid mode for updateManyStream', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

    const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
    const tableId = TableId.create(TABLE_ID)._unsafeUnwrap();
    const textFieldId = FieldId.create(NAME_FIELD_ID)._unsafeUnwrap();
    const recordIdA = RecordId.create(RECORD_ID)._unsafeUnwrap();
    const actorId = ActorId.create(ACTOR_ID)._unsafeUnwrap();

    const builder = Table.builder()
      .withId(tableId)
      .withBaseId(baseId)
      .withName(TableName.create('HybridTable')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(textFieldId)
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    builder.view().defaultGrid().done();

    const table = builder.build()._unsafeUnwrap();
    table
      .getField((field) => field.id().equals(textFieldId))
      ._unsafeUnwrap()
      .setDbFieldName(DbFieldName.rehydrate('col_name')._unsafeUnwrap())
      ._unsafeUnwrap();

    const updateResult = table
      .updateRecord(recordIdA, new Map([[NAME_FIELD_ID, 'Alice']]))
      ._unsafeUnwrap();

    const planStageSpy = vi.fn();
    const enqueueSeedTaskSpy = vi.fn().mockResolvedValue(ok({ taskId: 'seed-1', merged: false }));
    const scheduleDispatchSpy = vi.fn();

    const computedUpdatePlanner = {
      plan: async () => ok({ steps: [] }),
      planStage: planStageSpy,
      resolveBeforeImageRequirements: async () =>
        ok({ needsBeforeImage: false, requiredFieldIds: [] }),
    } as unknown as ComputedUpdatePlanner;

    const computedUpdateOutbox = {
      ...createNoopOutbox(),
      enqueueSeedTask: enqueueSeedTaskSpy,
    };

    const computedUpdateStrategy = {
      mode: 'hybrid' as const,
      name: 'hybrid',
      execute: async () => ok(undefined),
      scheduleDispatch: scheduleDispatchSpy,
    };

    const tableName = `"${BASE_ID}"."${TABLE_ID}"`;
    const { db } = createRecordingDb((compiledQuery) => {
      if (
        compiledQuery.sql.includes(`UPDATE ${tableName} AS t`) &&
        compiledQuery.sql.includes('RETURNING')
      ) {
        return [{ record_id: recordIdA.toString(), new_version: 2 }];
      }
      return [];
    });

    const repo = createHybridRepository(db, table, {
      computedUpdatePlanner,
      computedUpdateOutbox,
      computedUpdateStrategy,
    });

    function* batches() {
      yield ok([updateResult]);
    }

    const result = await repo.updateManyStream({ actorId }, table, batches());
    expect(result.isOk()).toBe(true);

    // planStage must NOT be called in hybrid mode
    expect(planStageSpy).not.toHaveBeenCalled();

    // enqueueSeedTask must be called with the seed data
    expect(enqueueSeedTaskSpy).toHaveBeenCalledTimes(1);
    const seedTask = enqueueSeedTaskSpy.mock.calls[0][0];
    expect(seedTask.seedTableId).toBe(tableId.toString());
    expect(seedTask.seedRecordIds).toContain(recordIdA.toString());
    expect(seedTask.changeType).toBe('update');

    // scheduleDispatch must be called
    expect(scheduleDispatchSpy).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('still calls planStage in sync mode for updateManyStream', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

    const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
    const tableId = TableId.create(TABLE_ID)._unsafeUnwrap();
    const textFieldId = FieldId.create(NAME_FIELD_ID)._unsafeUnwrap();
    const recordIdA = RecordId.create(RECORD_ID)._unsafeUnwrap();
    const actorId = ActorId.create(ACTOR_ID)._unsafeUnwrap();

    const builder = Table.builder()
      .withId(tableId)
      .withBaseId(baseId)
      .withName(TableName.create('SyncTable')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(textFieldId)
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    builder.view().defaultGrid().done();

    const table = builder.build()._unsafeUnwrap();
    table
      .getField((field) => field.id().equals(textFieldId))
      ._unsafeUnwrap()
      .setDbFieldName(DbFieldName.rehydrate('col_name')._unsafeUnwrap())
      ._unsafeUnwrap();

    const updateResult = table
      .updateRecord(recordIdA, new Map([[NAME_FIELD_ID, 'Bob']]))
      ._unsafeUnwrap();

    const planStageSpy = vi.fn().mockResolvedValue(
      ok({
        baseId: table.baseId(),
        seedTableId: table.id(),
        seedRecordIds: [recordIdA],
        extraSeedRecords: [],
        steps: [],
        edges: [],
        estimatedComplexity: 0,
        changeType: 'update' as const,
      })
    );
    const enqueueSeedTaskSpy = vi.fn().mockResolvedValue(ok({ taskId: 'seed-1', merged: false }));

    const computedUpdatePlanner = {
      plan: async () => ok({ steps: [] }),
      planStage: planStageSpy,
      resolveBeforeImageRequirements: async () =>
        ok({ needsBeforeImage: false, requiredFieldIds: [] }),
    } as unknown as ComputedUpdatePlanner;

    const computedUpdateOutbox = {
      ...createNoopOutbox(),
      enqueueSeedTask: enqueueSeedTaskSpy,
    };

    const syncStrategy = {
      mode: 'sync' as const,
      name: 'sync',
      execute: async () => ok(undefined),
      scheduleDispatch: vi.fn(),
    };

    const tableName = `"${BASE_ID}"."${TABLE_ID}"`;
    const { db } = createRecordingDb((compiledQuery) => {
      if (
        compiledQuery.sql.includes(`UPDATE ${tableName} AS t`) &&
        compiledQuery.sql.includes('RETURNING')
      ) {
        return [{ record_id: recordIdA.toString(), new_version: 2 }];
      }
      return [];
    });

    const repo = createHybridRepository(db, table, {
      computedUpdatePlanner,
      computedUpdateOutbox,
      computedUpdateStrategy: syncStrategy,
    });

    function* batches() {
      yield ok([updateResult]);
    }

    const result = await repo.updateManyStream({ actorId }, table, batches());
    expect(result.isOk()).toBe(true);

    // In sync mode, planStage MUST still be called
    expect(planStageSpy).toHaveBeenCalledTimes(1);

    // enqueueSeedTask must NOT be called in sync mode (plan had 0 steps)
    expect(enqueueSeedTaskSpy).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('does not call planStage in hybrid mode for updateMany (non-computed fields skip early)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

    const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
    const tableId = TableId.create(TABLE_ID)._unsafeUnwrap();
    const textFieldId = FieldId.create(NAME_FIELD_ID)._unsafeUnwrap();
    const recordId = RecordId.create(RECORD_ID)._unsafeUnwrap();
    const actorId = ActorId.create(ACTOR_ID)._unsafeUnwrap();

    const builder = Table.builder()
      .withId(tableId)
      .withBaseId(baseId)
      .withName(TableName.create('HybridBulkTable')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(textFieldId)
      .withName(FieldName.create('Status')._unsafeUnwrap())
      .primary()
      .done();
    builder.view().defaultGrid().done();

    const table = builder.build()._unsafeUnwrap();
    table
      .getField((field) => field.id().equals(textFieldId))
      ._unsafeUnwrap()
      .setDbFieldName(DbFieldName.rehydrate('col_status')._unsafeUnwrap())
      ._unsafeUnwrap();

    const mutateSpec = table
      .updateRecord(recordId, new Map([[NAME_FIELD_ID, 'done']]))
      ._unsafeUnwrap().mutateSpec;
    const filterSpec = buildRecordConditionSpec(table, {
      fieldId: textFieldId.toString(),
      operator: 'is',
      value: 'pending',
    })._unsafeUnwrap();

    const planStageSpy = vi.fn();
    const enqueueSeedTaskSpy = vi.fn().mockResolvedValue(ok({ taskId: 'seed-2', merged: false }));

    const computedUpdatePlanner = {
      plan: async () => ok({ steps: [] }),
      planStage: planStageSpy,
      resolveBeforeImageRequirements: async () =>
        ok({ needsBeforeImage: false, requiredFieldIds: [] }),
    } as unknown as ComputedUpdatePlanner;

    const computedUpdateOutbox = {
      ...createNoopOutbox(),
      enqueueSeedTask: enqueueSeedTaskSpy,
    };

    const computedUpdateStrategy = {
      mode: 'hybrid' as const,
      name: 'hybrid',
      execute: async () => ok(undefined),
      scheduleDispatch: vi.fn(),
    };

    const { db } = createRecordingDb((compiledQuery) => {
      if (compiledQuery.sql.includes('RETURNING')) {
        return [{ record_id: recordId.toString(), new_version: 2, old_version: 1 }];
      }
      return [];
    });

    const repo = createHybridRepository(db, table, {
      computedUpdatePlanner,
      computedUpdateOutbox,
      computedUpdateStrategy,
    });

    const result = await repo.updateMany({ actorId }, table, filterSpec, mutateSpec);
    expect(result.isOk()).toBe(true);

    // planStage must NOT be called in hybrid mode — even if no computed fields
    // exist, the code path should branch on strategy.mode before calling planStage
    expect(planStageSpy).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});

describe('PostgresTableRecordRepository deferred computed scheduling', () => {
  it('enqueues deferred computed work in the row transaction and dispatches after commit', async () => {
    const afterCommitHandlers: Array<() => void> = [];
    const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
    const tableId = TableId.create(TABLE_ID)._unsafeUnwrap();
    const textFieldId = FieldId.create(NAME_FIELD_ID)._unsafeUnwrap();
    const actorId = ActorId.create('system')._unsafeUnwrap();
    const transaction = {
      kind: 'unitOfWorkTransaction' as const,
      afterCommit: vi.fn((handler: () => void) => {
        afterCommitHandlers.push(handler);
      }),
    };

    const tableBuilder = Table.builder()
      .withId(tableId)
      .withBaseId(baseId)
      .withName(TableName.create('DeferredComputedTable')._unsafeUnwrap());
    tableBuilder
      .field()
      .singleLineText()
      .withId(textFieldId)
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    tableBuilder.view().defaultGrid().done();
    const table = tableBuilder.build()._unsafeUnwrap();
    const record = TableRecord.fromRawFieldValues({
      id: RECORD_ID,
      tableId,
      fields: { [NAME_FIELD_ID]: 'Alice' },
    })._unsafeUnwrap();

    const enqueueSeedTask = vi.fn(async () => ok({ taskId: 'cuo_deferred', merged: false }));
    const scheduleDispatch = vi.fn();
    const repositoryLike = {
      computedUpdateOutbox: { enqueueSeedTask },
      computedUpdateStrategy: { scheduleDispatch },
      expandComputedSeedFieldIds: vi.fn(() => [textFieldId]),
      hasher: { sha256: () => 'computed-seed-hash' },
    };

    const result = await (
      PostgresTableRecordRepository.prototype as unknown as {
        enqueueDeferredComputedUpdateMany: (
          context: unknown,
          table: unknown,
          records: ReadonlyArray<unknown>
        ) => Promise<ReturnType<typeof ok>>;
      }
    ).enqueueDeferredComputedUpdateMany.call(
      repositoryLike,
      { actorId, requestId: 'req-deferred-computed', transaction },
      table,
      [record]
    );

    expect(result.isOk()).toBe(true);
    expect(enqueueSeedTask).toHaveBeenCalledTimes(1);
    expect(enqueueSeedTask.mock.calls[0]?.[1]).toMatchObject({
      actorId,
      requestId: 'req-deferred-computed',
      transaction,
    });
    expect(transaction.afterCommit).toHaveBeenCalledTimes(1);
    expect(scheduleDispatch).not.toHaveBeenCalled();

    afterCommitHandlers[0]!();

    expect(scheduleDispatch).toHaveBeenCalledTimes(1);
    expect(scheduleDispatch.mock.calls[0]?.[0]).toMatchObject({
      actorId,
      requestId: 'req-deferred-computed',
    });
    expect(scheduleDispatch.mock.calls[0]?.[0]).not.toHaveProperty('transaction');
  });
});
