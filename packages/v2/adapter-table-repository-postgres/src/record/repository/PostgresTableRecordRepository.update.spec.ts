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
  TableRecordCellValue,
  ok,
} from '@teable/v2-core';
import type { ILogger } from '@teable/v2-core';
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

import type { ComputedFieldUpdater, ComputedUpdatePlanner, IUpdateStrategy } from '../computed';
import type { DynamicDB } from '../query-builder';
import { PostgresTableRecordRepository } from './PostgresTableRecordRepository';

// =============================================================================
// Test utilities
// =============================================================================

class RecordingConnection implements DatabaseConnection {
  constructor(private readonly queries: CompiledQuery[]) {}

  async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    this.queries.push(compiledQuery);
    return { rows: [] };
  }

  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    yield { rows: [] };
  }
}

class RecordingDriver implements Driver {
  readonly queries: CompiledQuery[] = [];

  async init(): Promise<void> {
    return undefined;
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    return new RecordingConnection(this.queries);
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

const createRecordingDb = () => {
  const driver = new RecordingDriver();
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
        changeType: 'update',
      }),
  } as unknown as ComputedUpdatePlanner;
};

const createNoopStrategy = (): IUpdateStrategy => {
  return {
    name: 'noop',
    execute: async () => ok(undefined),
  };
};

const createRepository = (db: Kysely<DynamicDB>, table: Table) => {
  const logger = createLogger();
  const computedUpdatePlanner = createNoopComputedPlanner(table);
  const computedFieldUpdater = {} as ComputedFieldUpdater;
  const computedUpdateStrategy = createNoopStrategy();

  return new PostgresTableRecordRepository(
    db as unknown as Kysely<V1TeableDatabase>,
    logger,
    computedUpdatePlanner,
    computedFieldUpdater,
    computedUpdateStrategy
  );
};

const toSnapshot = (queries: ReadonlyArray<CompiledQuery>) =>
  queries.map((query) => ({ sql: query.sql, parameters: query.parameters }));

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

// =============================================================================
// Tests
// =============================================================================

describe('PostgresTableRecordRepository.updateOne', () => {
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
          ],
          "sql": "update "bseaaaaaaaaaaaaaaaa"."tblbbbbbbbbbbbbbbbb" set "__last_modified_time" = $1, "__last_modified_by" = $2, "__version" = "__version" + 1, "col_name" = $3 where "__id" = $4",
        },
      ]
    `);

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
    expect(driver.queries).toHaveLength(4);

    expect(toSnapshot(driver.queries)).toMatchInlineSnapshot(`
      [
        {
          "parameters": [
            "rechhhhhhhhhhhhhhhh",
          ],
          "sql": "select \"__fk_fldeeeeeeeeeeeeeeee\" as \"record_id\" from \"bseaaaaaaaaaaaaaaaa\".\"junction_fldeeeeeeeeeeeeeeee_fldffffffffffffffff\" where \"__fk_fldffffffffffffffff\" = $1",
        },
        {
          "parameters": [
            "2025-01-01T00:00:00.000Z",
            "usr_test",
            "rechhhhhhhhhhhhhhhh",
          ],
          "sql": "update \"bseaaaaaaaaaaaaaaaa\".\"tblbbbbbbbbbbbbbbbb\" set \"__last_modified_time\" = $1, \"__last_modified_by\" = $2, \"__version\" = \"__version\" + 1 where \"__id\" = $3",
        },
        {
          "parameters": [
            "rechhhhhhhhhhhhhhhh",
          ],
          "sql": "delete from \"bseaaaaaaaaaaaaaaaa\".\"junction_fldeeeeeeeeeeeeeeee_fldffffffffffffffff\" where \"__fk_fldffffffffffffffff\" = $1",
        },
        {
          "parameters": [
            "rechhhhhhhhhhhhhhhh",
            "reciiiiiiiiiiiiiiii",
            "rechhhhhhhhhhhhhhhh",
            "recjjjjjjjjjjjjjjjj",
          ],
          "sql": "insert into \"bseaaaaaaaaaaaaaaaa\".\"junction_fldeeeeeeeeeeeeeeee_fldffffffffffffffff\" (\"__fk_fldffffffffffffffff\", \"__fk_fldeeeeeeeeeeeeeeee\") values ($1, $2), ($3, $4)",
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
    expect(driver.queries).toHaveLength(4);

    expect(toSnapshot(driver.queries)).toMatchInlineSnapshot(`
      [
        {
          "parameters": [
            "rechhhhhhhhhhhhhhhh",
          ],
          "sql": "select \"__id\" as \"record_id\" from \"bseaaaaaaaaaaaaaaaa\".\"tblcccccccccccccccc\" where \"__fk_fldffffffffffffffff\" = $1",
        },
        {
          "parameters": [
            "2025-01-01T00:00:00.000Z",
            "usr_test",
            "rechhhhhhhhhhhhhhhh",
          ],
          "sql": "update \"bseaaaaaaaaaaaaaaaa\".\"tblbbbbbbbbbbbbbbbb\" set \"__last_modified_time\" = $1, \"__last_modified_by\" = $2, \"__version\" = \"__version\" + 1 where \"__id\" = $3",
        },
        {
          "parameters": [
            null,
            "rechhhhhhhhhhhhhhhh",
          ],
          "sql": "update \"bseaaaaaaaaaaaaaaaa\".\"tblcccccccccccccccc\" set \"__fk_fldffffffffffffffff\" = $1 where \"__fk_fldffffffffffffffff\" = $2",
        },
        {
          "parameters": [
            "reciiiiiiiiiiiiiiii",
            "rechhhhhhhhhhhhhhhh",
            "recjjjjjjjjjjjjjjjj",
            "rechhhhhhhhhhhhhhhh",
          ],
          "sql": "update \"bseaaaaaaaaaaaaaaaa\".\"tblcccccccccccccccc\" as t set \"__fk_fldffffffffffffffff\" = \"v\".\"record_id\" from (values ($1, $2), ($3, $4)) as v(id, record_id) where \"t\".\"__id\" = \"v\".\"id\"",
        },
      ]
    `);

    vi.useRealTimers();
  });
});
