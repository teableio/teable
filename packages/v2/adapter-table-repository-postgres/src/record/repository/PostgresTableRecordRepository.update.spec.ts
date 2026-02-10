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
  ViewId,
  DefaultTableMapper,
  ok,
} from '@teable/v2-core';
import type {
  IHasher,
  ILogger,
  ITablePersistenceDTO,
  LinkField,
  IRecordOrderCalculator,
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
const VIEW_ID = `viw${'k'.repeat(16)}`;

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
    expect(driver.queries).toHaveLength(6);

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
            "[{\"id\":\"reciiiiiiiiiiiiiiii\"},{\"id\":\"recjjjjjjjjjjjjjjjj\"}]",
            "rechhhhhhhhhhhhhhhh",
          ],
          "sql": "update "bseaaaaaaaaaaaaaaaa"."tblbbbbbbbbbbbbbbbb" set "__last_modified_time" = $1, "__last_modified_by" = $2, "__version" = "__version" + 1, "col_links" = $3 where "__id" = $4",
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
    expect(driver.queries).toHaveLength(7);

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
            "[{\"id\":\"reciiiiiiiiiiiiiiii\"},{\"id\":\"recjjjjjjjjjjjjjjjj\"}]",
            "rechhhhhhhhhhhhhhhh",
          ],
          "sql": "update "bseaaaaaaaaaaaaaaaa"."tblbbbbbbbbbbbbbbbb" set "__last_modified_time" = $1, "__last_modified_by" = $2, "__version" = "__version" + 1, "col_links" = $3 where "__id" = $4",
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
