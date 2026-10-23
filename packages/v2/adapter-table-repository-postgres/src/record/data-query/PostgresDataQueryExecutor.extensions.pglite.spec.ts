import {
  ActorId,
  buildRecordConditionSpec,
  DefaultTableMapper,
  LookupField,
  type ITablePersistenceDTO,
  type Table,
} from '@teable/v2-core';
import { DataQueryDefinition } from '@teable/v2-data-query';
import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createPGliteDb,
  type PGliteTestDb,
} from '../../schema/visitors/__tests__/helpers/createPGliteDb';
import { PostgresDataQueryExecutor } from './PostgresDataQueryExecutor';

const tableId = `tbl${'q'.repeat(16)}`;
const foreignTableId = `tbl${'r'.repeat(16)}`;
const titleId = `fld${'a'.repeat(16)}`;
const amountId = `fld${'b'.repeat(16)}`;
const categoryId = `fld${'c'.repeat(16)}`;
const linkId = `fld${'d'.repeat(16)}`;
const lookupId = `fld${'e'.repeat(16)}`;
const foreignValueId = `fld${'f'.repeat(16)}`;
const context = { actorId: ActorId.create('system')._unsafeUnwrap() };
const physicalTable = 'pglite_query_extensions';
const mapper = new DefaultTableMapper();

const hostDto = (): ITablePersistenceDTO => ({
  id: tableId,
  baseId: 'bseaaaaaaaaaaaaaaaa',
  name: 'Query extensions',
  dbTableName: `public.${physicalTable}`,
  primaryFieldId: titleId,
  fields: [
    { id: titleId, name: 'Title', type: 'singleLineText', dbFieldName: 'title' },
    { id: amountId, name: 'Amount', type: 'number', dbFieldName: 'amount' },
    { id: categoryId, name: 'Category', type: 'singleLineText', dbFieldName: 'category' },
    {
      id: linkId,
      name: 'Relation',
      type: 'link',
      dbFieldName: 'relation',
      options: {
        relationship: 'manyMany',
        foreignTableId,
        lookupFieldId: foreignValueId,
        fkHostTableName: 'junction',
        selfKeyName: '__self',
        foreignKeyName: '__foreign',
      },
    },
    {
      id: lookupId,
      name: 'Tags',
      type: 'singleLineText',
      dbFieldName: 'tags',
      isLookup: true,
      lookupOptions: { linkFieldId: linkId, foreignTableId, lookupFieldId: foreignValueId },
      options: {},
      cellValueType: 'string',
      isMultipleCellValue: true,
    },
  ],
  views: [{ id: `viw${'a'.repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
});

const foreignDto = (): ITablePersistenceDTO => ({
  id: foreignTableId,
  baseId: 'bseaaaaaaaaaaaaaaaa',
  name: 'Query extensions foreign',
  dbTableName: 'public.pglite_query_extensions_foreign',
  primaryFieldId: foreignValueId,
  fields: [{ id: foreignValueId, name: 'Value', type: 'singleLineText', dbFieldName: 'value' }],
  views: [{ id: `viw${'b'.repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
});

const records = (extra: Record<string, unknown> = {}) =>
  DataQueryDefinition.create({
    version: 1,
    tableId,
    kind: 'records',
    select: [
      { system: 'id', alias: 'id' },
      { fieldId: titleId, alias: 'title' },
      { fieldId: categoryId, alias: 'category' },
    ],
    ...extra,
  });

const optionalLeaf = (optional = true) => ({
  fieldId: titleId,
  operator: 'is' as const,
  value: { type: 'parameter' as const, name: 'title' },
  ...(optional ? { optional: true } : {}),
});

describe('Postgres data query extensions on PGlite', () => {
  let database: PGliteTestDb;
  let table: Table;
  let executor: PostgresDataQueryExecutor;

  beforeEach(async () => {
    database = await createPGliteDb();
    const foreign = mapper.toDomain(foreignDto())._unsafeUnwrap();
    table = mapper.toDomain(hostDto())._unsafeUnwrap();
    const lookup = table
      .getField((candidate) => candidate.id().toString() === lookupId)
      ._unsafeUnwrap();
    if (lookup instanceof LookupField) {
      lookup
        .validateForeignTables({ hostTable: table, foreignTables: [table, foreign] })
        ._unsafeUnwrap();
    }
    executor = new PostgresDataQueryExecutor(database.db);
    await sql`create table ${sql.id('public', physicalTable)} (
      __id text primary key, title text, amount double precision, category text,
      relation jsonb, tags jsonb, __created_time timestamptz default '2026-01-01T00:00:00Z',
      __last_modified_time timestamptz, __auto_number bigint, __version integer default 1
    )`.execute(database.db);
    const rows: [string, string, number, string, unknown][] = [
      ['recA', 'Alpha', 10, 'x', ['Mei', 'Ravi', 'Mei']],
      ['recB', 'Beta', 20, 'y', ['Ravi', null, null, ['nested'], ['nested']]],
      [
        'recC',
        'Gamma',
        10,
        'x',
        [
          { id: 'usr1', title: 'Same' },
          { id: 'usr1', title: 'Same' },
          { id: 'usr2', title: 'Different' },
        ],
      ],
      ['recD', 'Delta', null, null, null],
    ];
    for (const [id, title, amount, category, tags] of rows) {
      await sql`insert into ${sql.id('public', physicalTable)}
        (__id, title, amount, category, tags) values (${id}, ${title}, ${amount}, ${category},
        ${tags === null ? null : JSON.stringify(tags)}::jsonb)`.execute(database.db);
    }
  });

  afterEach(async () => {
    await database.db.destroy();
  });

  it('prunes absent optional leaves in and/or/not and keeps required predicates', async () => {
    const conjunction = records({
      parameters: { title: { type: 'string' } },
      filter: {
        conjunction: 'and',
        items: [{ fieldId: categoryId, operator: 'is', value: 'x' }, optionalLeaf()],
      },
    })
      ._unsafeUnwrap()
      .bind({})
      ._unsafeUnwrap();
    expect(
      (await executor.execute(context, table, conjunction, {}))
        ._unsafeUnwrap()
        .rows.map((row) => row.id)
    ).toEqual(['recA', 'recC']);
    const filtered = records({
      parameters: { title: { type: 'string' } },
      filter: {
        conjunction: 'and',
        items: [{ fieldId: categoryId, operator: 'is', value: 'x' }, optionalLeaf()],
      },
    })
      ._unsafeUnwrap()
      .bind({ title: 'Gamma' })
      ._unsafeUnwrap();
    expect(
      (await executor.execute(context, table, filtered, {}))
        ._unsafeUnwrap()
        .rows.map((row) => row.id)
    ).toEqual(['recC']);
    const disjunction = records({
      parameters: { title: { type: 'string' } },
      filter: {
        conjunction: 'or',
        items: [optionalLeaf(), { fieldId: categoryId, operator: 'is', value: 'y' }],
      },
    })
      ._unsafeUnwrap()
      .bind({})
      ._unsafeUnwrap();
    expect(
      (await executor.execute(context, table, disjunction, {}))
        ._unsafeUnwrap()
        .rows.map((row) => row.id)
    ).toEqual(['recB']);
    const negated = records({
      parameters: { title: { type: 'string' } },
      filter: { not: optionalLeaf() },
    })
      ._unsafeUnwrap()
      .bind({ title: 'Gamma' })
      ._unsafeUnwrap();
    expect(
      (await executor.execute(context, table, negated, {}))
        ._unsafeUnwrap()
        .rows.map((row) => row.id)
    ).toEqual(['recA', 'recB', 'recD']);
    expect(
      records({ parameters: { title: { type: 'string' } }, filter: { not: optionalLeaf() } })
        ._unsafeUnwrap()
        .bind({})
        ._unsafeUnwrap().filter
    ).toBeUndefined();
  });

  it('resolves parameterized sort through the allow-list without parameterizing identifiers', async () => {
    const definition = records({
      parameters: { by: { type: 'string' }, dir: { type: 'string' } },
      sort: [
        {
          field: { type: 'parameter', name: 'by' },
          order: { type: 'parameter', name: 'dir' },
          allowed: [{ fieldId: amountId }, { system: 'id' }],
        },
      ],
    })._unsafeUnwrap();
    const bound = definition.bind({ by: amountId, dir: 'desc' })._unsafeUnwrap();
    expect(bound.sort).toEqual([{ fieldId: amountId, order: 'desc' }]);
    const compiled = executor.compile(context, table, bound, {})._unsafeUnwrap();
    expect(compiled.parameters).not.toContain(amountId);
    expect(compiled.sql).toContain('"t"."amount" desc nulls last');
    expect(compiled.sql).not.toContain(amountId);
    expect(
      (await executor.execute(context, table, bound, {}))._unsafeUnwrap().rows.map((row) => row.id)
    ).toEqual(['recB', 'recA', 'recC', 'recD']);
    expect(definition.bind({ by: 'title', dir: 'asc' }).isErr()).toBe(true);
    expect(definition.bind({ by: amountId, dir: 'sideways' }).isErr()).toBe(true);
    const optional = records({
      parameters: { by: { type: 'string' } },
      sort: [
        {
          field: { type: 'parameter', name: 'by' },
          order: 'asc',
          allowed: [{ fieldId: amountId }],
          optional: true,
        },
      ],
    })
      ._unsafeUnwrap()
      .bind({})
      ._unsafeUnwrap();
    expect(optional.sort).toEqual([]);
    // Every allow-listed target is a dependency: hiding any of them fails closed.
    expect(
      executor
        .compile(context, table, bound, {
          readableFieldIds: new Set([titleId, categoryId]),
        })
        .isErr()
    ).toBe(true);
  });

  it('orders aggregates by an output alias without re-evaluating the aggregate', async () => {
    const definition = DataQueryDefinition.create({
      version: 1,
      tableId,
      kind: 'aggregate',
      groupBy: [{ fieldId: categoryId, alias: 'bucket' }],
      aggregates: [{ fieldId: amountId, statisticFunc: 'max', alias: 'maximum' }],
      sort: [{ alias: 'maximum', order: 'desc' }],
    })._unsafeUnwrap();
    const bound = definition.bind({})._unsafeUnwrap();
    expect(bound.sort).toEqual([{ alias: 'maximum', order: 'desc' }]);
    const compiled = executor.compile(context, table, bound, {})._unsafeUnwrap();
    expect(compiled.sql).toContain('order by "maximum" desc nulls last');
    expect((await executor.execute(context, table, bound, {}))._unsafeUnwrap().rows).toEqual([
      { bucket: 'y', maximum: 20 },
      { bucket: 'x', maximum: 10 },
      { bucket: null, maximum: null },
    ]);
    expect(
      (await executor.execute(context, table, bound, {}))._unsafeUnwrap().page
    ).toBeUndefined();
    expect(
      DataQueryDefinition.create({
        version: 1,
        tableId,
        kind: 'aggregate',
        groupBy: [{ fieldId: categoryId, alias: 'bucket' }],
        aggregates: [{ fieldId: amountId, statisticFunc: 'max', alias: 'maximum' }],
        sort: [{ alias: 'unknown', order: 'asc' }],
      }).isErr()
    ).toBe(true);
  });

  it('honours an explicit null ordering on a sort item', async () => {
    const definition = DataQueryDefinition.create({
      version: 1,
      tableId,
      kind: 'aggregate',
      groupBy: [{ fieldId: categoryId, alias: 'bucket' }],
      aggregates: [{ fieldId: amountId, statisticFunc: 'max', alias: 'maximum' }],
      sort: [{ alias: 'maximum', order: 'desc', nulls: 'first' }],
    })
      ._unsafeUnwrap()
      .bind({})
      ._unsafeUnwrap();
    expect(definition.sort).toEqual([{ alias: 'maximum', order: 'desc', nulls: 'first' }]);
    expect(executor.compile(context, table, definition, {})._unsafeUnwrap().sql).toContain(
      'order by "maximum" desc nulls first'
    );
    expect((await executor.execute(context, table, definition, {}))._unsafeUnwrap().rows).toEqual([
      { bucket: null, maximum: null },
      { bucket: 'y', maximum: 20 },
      { bucket: 'x', maximum: 10 },
    ]);
  });

  it('quotes a special-character aggregate alias and shares one repeatable-read snapshot', async () => {
    const alias = 'max "value"';
    const definition = DataQueryDefinition.create({
      version: 1,
      tableId,
      kind: 'aggregate',
      aggregates: [{ fieldId: amountId, statisticFunc: 'max', alias }],
      sort: [{ alias, order: 'desc' }],
    })
      ._unsafeUnwrap()
      .bind({})
      ._unsafeUnwrap();
    expect(executor.compile(context, table, definition, {})._unsafeUnwrap().sql).toContain(
      'order by "max ""value""" desc nulls last'
    );
    const statements: string[] = [];
    const recordingDb = new Proxy(database.db as object, {
      get(target, property) {
        if (property === 'transaction') {
          return () => ({
            execute: (callback: (transaction: unknown) => Promise<unknown>) =>
              database.db.transaction().execute((transaction) =>
                callback({
                  executeQuery: (compiled: { sql: string }) => {
                    statements.push(compiled.sql);
                    return transaction.executeQuery(compiled as never);
                  },
                })
              ),
          });
        }
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as typeof database.db;
    const recordingExecutor = new PostgresDataQueryExecutor(recordingDb);
    const page = records({ page: { limit: 1, includeTotal: true } })
      ._unsafeUnwrap()
      .bind({})
      ._unsafeUnwrap();
    const result = await recordingExecutor.execute(context, table, page, {});
    if (result.isErr()) throw new Error(JSON.stringify(result.error));
    expect(statements[0]).toContain('set transaction isolation level repeatable read');
    expect(statements).toHaveLength(5);
  });

  it('returns rows and the same-scope total for full, empty and out-of-range pages', async () => {
    const definition = records({ page: { limit: 2, includeTotal: true } })
      ._unsafeUnwrap()
      .bind({})
      ._unsafeUnwrap();
    expect((await executor.execute(context, table, definition, {}))._unsafeUnwrap()).toMatchObject({
      page: { limit: 2, offset: 0, total: 4 },
    });
    const empty = records({
      page: { limit: 2, offset: 4, includeTotal: true },
      filter: { fieldId: categoryId, operator: 'is', value: 'x' },
    })
      ._unsafeUnwrap()
      .bind({})
      ._unsafeUnwrap();
    expect((await executor.execute(context, table, empty, {}))._unsafeUnwrap()).toEqual({
      rows: [],
      page: { limit: 2, offset: 4, total: 2 },
    });
    const beyond = records({ page: { limit: 2, offset: 100, includeTotal: true } })
      ._unsafeUnwrap()
      .bind({})
      ._unsafeUnwrap();
    expect((await executor.execute(context, table, beyond, {}))._unsafeUnwrap()).toMatchObject({
      rows: [],
      page: { total: 4 },
    });
    const recordSpec = buildRecordConditionSpec(table, {
      fieldId: categoryId,
      operator: 'is',
      value: 'x',
    })._unsafeUnwrap();
    const scoped = records({ page: { limit: 1, includeTotal: true } })
      ._unsafeUnwrap()
      .bind({})
      ._unsafeUnwrap();
    expect(
      (await executor.execute(context, table, scoped, { recordSpec }))._unsafeUnwrap()
    ).toMatchObject({ page: { total: 2 } });
    const masked = records({ page: { limit: 1, includeTotal: true } })
      ._unsafeUnwrap()
      .bind({})
      ._unsafeUnwrap();
    expect(
      (
        await executor.execute(context, table, masked, {
          fieldMasks: [{ fieldId: amountId, visibleWhen: recordSpec }],
        })
      )._unsafeUnwrap().page
    ).toEqual({ limit: 1, offset: 0, total: 4 });
    const withoutTotal = records({ page: { limit: 2 } })
      ._unsafeUnwrap()
      .bind({})
      ._unsafeUnwrap();
    expect(
      (await executor.execute(context, table, withoutTotal, {}))._unsafeUnwrap().page
    ).toBeUndefined();
  });

  it('counts aggregate result groups and the single ungrouped row', async () => {
    const grouped = DataQueryDefinition.create({
      version: 1,
      tableId,
      kind: 'aggregate',
      groupBy: [{ fieldId: categoryId, alias: 'bucket' }],
      aggregates: [{ fieldId: amountId, statisticFunc: 'count', alias: 'count' }],
      page: { limit: 2, includeTotal: true },
    })
      ._unsafeUnwrap()
      .bind({})
      ._unsafeUnwrap();
    const groupedResult = (await executor.execute(context, table, grouped, {}))._unsafeUnwrap();
    expect(groupedResult.rows).toHaveLength(2);
    expect(groupedResult.page).toEqual({ limit: 2, offset: 0, total: 3 });
    const ungrouped = DataQueryDefinition.create({
      version: 1,
      tableId,
      kind: 'aggregate',
      aggregates: [{ fieldId: amountId, statisticFunc: 'sum', alias: 'total' }],
      page: { limit: 1, includeTotal: true },
    })
      ._unsafeUnwrap()
      .bind({})
      ._unsafeUnwrap();
    expect((await executor.execute(context, table, ungrouped, {}))._unsafeUnwrap()).toEqual({
      rows: [{ total: 40 }],
      page: { limit: 1, offset: 0, total: 1 },
    });
  });

  it('deduplicates multi-value lookup arrays in PostgreSQL with first-occurrence order', async () => {
    const definition = DataQueryDefinition.create({
      version: 1,
      tableId,
      kind: 'records',
      select: [
        { system: 'id', alias: 'id' },
        { fieldId: lookupId, alias: 'raw' },
        { fieldId: lookupId, alias: 'deduped', arrayDistinct: true },
      ],
    })._unsafeUnwrap();
    const bound = definition.bind({})._unsafeUnwrap();
    const rows = (await executor.execute(context, table, bound, {}))._unsafeUnwrap().rows;
    expect(rows).toEqual([
      { id: 'recA', raw: ['Mei', 'Ravi', 'Mei'], deduped: ['Mei', 'Ravi'] },
      {
        id: 'recB',
        raw: ['Ravi', null, null, ['nested'], ['nested']],
        deduped: ['Ravi', null, ['nested']],
      },
      {
        id: 'recC',
        raw: [
          { id: 'usr1', title: 'Same' },
          { id: 'usr1', title: 'Same' },
          { id: 'usr2', title: 'Different' },
        ],
        deduped: [
          { id: 'usr1', title: 'Same' },
          { id: 'usr2', title: 'Different' },
        ],
      },
      { id: 'recD', raw: null, deduped: null },
    ]);
    expect(executor.compile(context, table, bound, {})._unsafeUnwrap().sql).toContain(
      'jsonb_array_elements'
    );
    const scalar = DataQueryDefinition.create({
      version: 1,
      tableId,
      kind: 'records',
      select: [{ fieldId: titleId, alias: 'title', arrayDistinct: true }],
    })
      ._unsafeUnwrap()
      .bind({})
      ._unsafeUnwrap();
    expect(executor.compile(context, table, scalar, {}).isErr()).toBe(true);
    expect((await executor.execute(context, table, scalar, {})).isErr()).toBe(true);
  });
});
