import { createV2PostgresDb } from '@teable/v2-adapter-db-postgres-pg';
import {
  ActorId,
  BaseId,
  buildRecordConditionSpec,
  DbFieldName,
  DefaultTableMapper,
  FieldId,
  FieldName,
  LookupField,
  Table,
  TableId,
  TableName,
  type ITablePersistenceDTO,
} from '@teable/v2-core';
import { DataQueryDefinition } from '@teable/v2-data-query';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresDataQueryExecutor } from './PostgresDataQueryExecutor';

// PGlite cannot interrupt a running statement; use an actual server for cancellation.
const describePg = process.env.TEABLE_V2_RUN_PG_INTEGRATION === '1' ? describe : describe.skip;
const baseId = BaseId.create(`bse${'s'.repeat(16)}`)._unsafeUnwrap();
const titleId = FieldId.create(`fld${'t'.repeat(16)}`)._unsafeUnwrap();
const context = { actorId: ActorId.create('query-budget-actor')._unsafeUnwrap() };

const tableFor = (seed: string) => {
  const builder = Table.builder()
    .withId(TableId.create(`tbl${seed.repeat(16)}`)._unsafeUnwrap())
    .withBaseId(baseId)
    .withName(TableName.create('Query budget')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withId(titleId)
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  builder.view().defaultGrid().done();
  const table = builder.build()._unsafeUnwrap();
  table
    .getField((field) => field.id().equals(titleId))
    ._unsafeUnwrap()
    .setDbFieldName(DbFieldName.rehydrate('Title')._unsafeUnwrap())
    ._unsafeUnwrap();
  return table;
};

const boundFor = (table: Table) =>
  DataQueryDefinition.create({
    version: 1,
    kind: 'records',
    tableId: table.id().toString(),
    select: [{ fieldId: titleId.toString(), alias: 'title' }],
    page: { limit: 10 },
  })
    ._unsafeUnwrap()
    .bind({})
    ._unsafeUnwrap();

const withDeadline = async <T>(operation: Promise<T>): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Data query failed to cancel within 10 seconds')),
          10_000
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

describePg('PostgresDataQueryExecutor transaction isolation (Postgres)', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let db: Kysely<V1TeableDatabase>;
  let holder: Kysely<V1TeableDatabase>;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(
      process.env.TEABLE_V2_TEST_PG_IMAGE ?? 'postgres:16-alpine'
    ).start();
    const config = { pg: { connectionString: container.getConnectionUri(), pool: { max: 1 } } };
    db = await createV2PostgresDb<V1TeableDatabase>(config);
    holder = await createV2PostgresDb<V1TeableDatabase>(config);
    await sql`create schema ${sql.id(baseId.toString())}`.execute(db);
  });

  afterAll(async () => {
    await holder?.destroy();
    await db?.destroy();
    await container?.stop();
  });

  it.each(['createdBy', 'lastModifiedBy'] as const)(
    'aggregates historical %s TEXT identities without a JSON cast failure',
    async (fieldType) => {
      const userId = `fld${'u'.repeat(16)}`;
      const physicalName = `historical_${fieldType}`;
      const dto: ITablePersistenceDTO = {
        id: `tbl${'u'.repeat(16)}`,
        baseId: baseId.toString(),
        name: 'Historical system users',
        dbTableName: `${baseId.toString()}.${physicalName}`,
        primaryFieldId: titleId.toString(),
        fields: [
          {
            id: titleId.toString(),
            name: 'Title',
            type: 'singleLineText',
            dbFieldName: 'title',
            isPrimary: true,
          },
          { id: userId, name: 'System user', type: fieldType, dbFieldName: 'system_user' },
        ],
        views: [{ id: `viw${'u'.repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
      };
      const table = new DefaultTableMapper().toDomain(dto)._unsafeUnwrap();
      const physical = sql.id(baseId.toString(), physicalName);
      await sql`create table ${physical} (__id text, title text, "system_user" text)`.execute(db);
      await sql`insert into ${physical} values
        ('a', 'First', 'user-a'), ('b', 'Second', 'user-a'),
        ('c', 'Third', 'user-b'), ('d', 'Empty', null)`.execute(db);
      const query = DataQueryDefinition.create({
        version: 1,
        kind: 'aggregate',
        tableId: dto.id,
        aggregates: [
          { fieldId: userId, alias: 'unique', statisticFunc: 'unique' },
          { fieldId: userId, alias: 'percentUnique', statisticFunc: 'percentUnique' },
          { fieldId: userId, alias: 'count', statisticFunc: 'count' },
        ],
      })
        ._unsafeUnwrap()
        .bind({})
        ._unsafeUnwrap();
      const executor = new PostgresDataQueryExecutor(db);
      expect((await executor.execute(context, table, query, {}))._unsafeUnwrap().rows).toEqual([
        { unique: 2, percentUnique: 50, count: 4 },
      ]);
      const visibleWhen = buildRecordConditionSpec(table, {
        fieldId: titleId.toString(),
        operator: 'is',
        value: 'First',
      })._unsafeUnwrap();
      expect(
        (
          await executor.execute(context, table, query, {
            fieldMasks: [{ fieldId: userId, visibleWhen }],
          })
        )._unsafeUnwrap().rows
      ).toEqual([{ unique: 1, percentUnique: 25, count: 4 }]);
      await sql`alter table ${physical} alter column "system_user" type jsonb using
        case when "system_user" is null then null else jsonb_build_object('id', "system_user", 'name', 'Original') end`.execute(
        db
      );
      await sql`update ${physical} set "system_user" = jsonb_build_object('id', 'user-a', 'name', 'Renamed') where __id = 'b'`.execute(
        db
      );
      expect((await executor.execute(context, table, query, {}))._unsafeUnwrap().rows).toEqual([
        { unique: 2, percentUnique: 50, count: 4 },
      ]);
    }
  );

  it.each(['lookup', 'rollup'] as const)(
    'reads a three-table lookup to %s using the foreign owner',
    async (innerKind) => {
      const mapper = new DefaultTableMapper();
      const ids = ['d', 'e', 'f'].map((seed) => `tbl${seed.repeat(16)}`);
      const primary = ['d', 'e', 'f'].map((seed) => `fld${seed.repeat(16)}`);
      const links = ['g', 'h'].map((seed) => `fld${seed.repeat(16)}`);
      const lookups = ['i', 'j'].map((seed) => `fld${seed.repeat(16)}`);
      const dtos: ITablePersistenceDTO[] = ids.map((id, index) => ({
        id,
        baseId: baseId.toString(),
        name: `Nested ${index}`,
        dbTableName: `${baseId.toString()}.nested_${innerKind}_${index}`,
        primaryFieldId: primary[index],
        fields: [
          {
            id: primary[index],
            name: 'Value',
            type: 'number',
            dbFieldName: 'value',
            isPrimary: true,
            options: { formatting: { type: 'decimal', precision: 0 } },
          },
        ],
        views: [
          { id: `viw${String(index).repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} },
        ],
      }));
      for (const index of [0, 1]) {
        dtos[index].fields = [
          ...dtos[index].fields,
          {
            id: links[index],
            name: 'Relation',
            type: 'link',
            dbFieldName: 'relation',
            options: {
              relationship: 'manyMany',
              foreignTableId: ids[index + 1],
              lookupFieldId: primary[index + 1],
              fkHostTableName: 'junction',
              selfKeyName: '__self',
              foreignKeyName: '__foreign',
            },
          },
        ];
        const config = {
          linkFieldId: links[index],
          foreignTableId: ids[index + 1],
          lookupFieldId: index === 0 ? lookups[1] : primary[2],
        };
        dtos[index].fields = [
          ...dtos[index].fields,
          index === 1 && innerKind === 'rollup'
            ? {
                id: lookups[index],
                name: 'Total',
                type: 'rollup',
                dbFieldName: 'nested',
                config,
                options: { expression: 'sum({values})' },
                cellValueType: 'number',
                isMultipleCellValue: false,
              }
            : {
                id: lookups[index],
                name: 'Lookup',
                type: 'number',
                dbFieldName: 'nested',
                isLookup: true,
                lookupOptions: config,
                options: { formatting: { type: 'decimal', precision: 0 } },
                cellValueType: 'number',
                isMultipleCellValue: true,
              },
        ];
      }
      const tables = dtos.map((dto) => mapper.toDomain(dto)._unsafeUnwrap());
      for (const index of [1, 0]) {
        const field = tables[index]
          .getField((candidate) => candidate.id().toString() === lookups[index])
          ._unsafeUnwrap();
        if (field instanceof LookupField) {
          field
            .validateForeignTables({ hostTable: tables[index], foreignTables: tables })
            ._unsafeUnwrap();
        }
      }
      const physical = sql.id(baseId.toString(), `nested_${innerKind}_0`);
      await sql`create table ${physical} (__id text, value double precision, relation jsonb, nested jsonb)`.execute(
        db
      );
      await sql`insert into ${physical} values ('a', 1, null, '[2,3]'::jsonb)`.execute(db);
      const query = DataQueryDefinition.create({
        version: 1,
        kind: 'records',
        tableId: ids[0],
        select: [{ fieldId: lookups[0], alias: 'nested' }],
      })
        ._unsafeUnwrap()
        .bind({})
        ._unsafeUnwrap();
      const executor = new PostgresDataQueryExecutor(db);
      expect((await executor.execute(context, tables[0], query, {}))._unsafeUnwrap().rows).toEqual([
        { nested: [2, 3] },
      ]);
    }
  );
  it('cancels a blocked query and returns the connection to a usable session', async () => {
    const table = tableFor('a');
    const physical = sql.id(baseId.toString(), table.id().toString());
    await sql`create table ${physical} ("__id" text primary key, "Title" text)`.execute(db);
    await sql`insert into ${physical} values ('record-a', 'Visible')`.execute(db);
    const executor = new PostgresDataQueryExecutor(db, { statementTimeoutMs: 100 });
    const query = boundFor(table);
    let signalLocked!: () => void;
    let releaseLock!: () => void;
    const locked = new Promise<void>((resolve) => {
      signalLocked = resolve;
    });
    const released = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const blocker = holder.transaction().execute(async (transaction) => {
      await sql`lock table ${physical} in access exclusive mode`.execute(transaction);
      signalLocked();
      await released;
    });
    await Promise.race([locked, blocker]);
    try {
      const result = await withDeadline(executor.execute(context, table, query, {}));
      expect(result._unsafeUnwrapErr()).toMatchObject({
        code: 'data_query.timeout',
        details: { sqlState: '57014' },
      });
    } finally {
      releaseLock();
      await blocker;
    }
    expect((await executor.execute(context, table, query, {}))._unsafeUnwrap().rows).toEqual([
      { title: 'Visible' },
    ]);
    await sql`insert into ${physical} values ('record-b', 'Writable after read')`.execute(db);
    expect((await executor.execute(context, table, query, {}))._unsafeUnwrap().rows).toEqual([
      { title: 'Visible' },
      { title: 'Writable after read' },
    ]);
  });

  it('blocks a mutating function hidden behind a database view', async () => {
    const table = tableFor('b');
    const physical = sql.id(baseId.toString(), table.id().toString());
    await sql`create sequence data_query_side_effect`.execute(db);
    await sql`create view ${physical} as select 'record-a'::text as "__id", nextval('data_query_side_effect')::text as "Title"`.execute(
      db
    );
    const executor = new PostgresDataQueryExecutor(db);
    const result = await executor.execute(context, table, boundFor(table), {});
    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: 'data_query.execution_failed',
      details: { sqlState: '25006' },
    });
    const state = await sql<{
      is_called: boolean;
    }>`select is_called from data_query_side_effect`.execute(db);
    expect(state.rows).toEqual([{ is_called: false }]);
  });
});
