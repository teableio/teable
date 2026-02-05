import {
  ActorId,
  BaseId,
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
import { PostgresTableRecordRepository } from './PostgresTableRecordRepository';

// =============================================================================
// Test utilities
// =============================================================================

type RowProvider = (compiledQuery: CompiledQuery) => unknown[];

class RecordingConnection implements DatabaseConnection {
  constructor(
    private readonly queries: CompiledQuery[],
    private readonly rowProvider?: RowProvider
  ) {}

  async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    this.queries.push(compiledQuery);
    const rows = (this.rowProvider?.(compiledQuery) ?? []) as R[];
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
  const driver = new RecordingDriver(rowProvider);
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
    markDone: async () => ok(undefined),
    markFailed: async () => ok(undefined),
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

const createRepository = (db: Kysely<DynamicDB>, table: Table) => {
  const logger = createLogger();
  const computedUpdatePlanner = createNoopComputedPlanner(table);
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
    hasher
  );
};

const toSnapshot = (queries: ReadonlyArray<CompiledQuery>) =>
  queries.map((query) => ({ sql: query.sql, parameters: query.parameters }));

const createRecordIdRowProvider = (tableName: string, recordIds: string[]): RowProvider => {
  const target = `from ${tableName}`;
  return (compiledQuery) => {
    if (
      compiledQuery.sql.includes('select "__id" as "record_id"') &&
      compiledQuery.sql.includes(target)
    ) {
      return recordIds.map((recordId) => ({ record_id: recordId }));
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
            2025-01-01T00:00:00.000Z,
            "usr_test",
            "tblbbbbbbbbbbbbbbbb",
          ],
          "sql": "update "table_meta" set "last_modified_time" = $1, "last_modified_by" = $2 where "id" = $3",
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
    const rowProvider = createRecordIdRowProvider(tableName, [
      recordId.toString(),
      recordIdB.toString(),
    ]);

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
            2025-01-01T00:00:00.000Z,
            "usr_test",
            "tblbbbbbbbbbbbbbbbb",
          ],
          "sql": "update "table_meta" set "last_modified_time" = $1, "last_modified_by" = $2 where "id" = $3",
        },
      ]
    `);
    vi.useRealTimers();
  });
});
