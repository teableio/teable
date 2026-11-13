import { readFileSync } from 'node:fs';

import {
  ActorId,
  buildRecordConditionSpec,
  DefaultTableMapper,
  type ITablePersistenceDTO,
  type RecordQueryPluginScope,
  type Table,
} from '@teable/v2-core';
import { DataQueryDefinition, DataQueryRelationBinding } from '@teable/v2-data-query';
import { PgLegacyTypeValidationStrategy } from '@teable/v2-formula-sql-pg';
import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createPGliteDb,
  type PGliteTestDb,
} from '../../schema/visitors/__tests__/helpers/createPGliteDb';
import { PostgresDataQueryExecutor } from './PostgresDataQueryExecutor';

const rootId = `tbl${'a'.repeat(16)}`;
const targetId = `tbl${'b'.repeat(16)}`;
const titleId = `fld${'a'.repeat(16)}`;
const amountId = `fld${'b'.repeat(16)}`;
const floatId = `fld${'c'.repeat(16)}`;
const payloadId = `fld${'d'.repeat(16)}`;
const ownerId = `fld${'e'.repeat(16)}`;
const itemsId = `fld${'f'.repeat(16)}`;
const dueId = `fld${'g'.repeat(16)}`;
const context = { actorId: ActorId.create('system')._unsafeUnwrap() };
const mapper = new DefaultTableMapper();
const rootDto = (): ITablePersistenceDTO => ({
  id: rootId,
  baseId: `bse${'a'.repeat(16)}`,
  name: 'Distinct',
  dbTableName: 'public.distinct_root',
  primaryFieldId: titleId,
  fields: [
    { id: titleId, name: 'Title', type: 'singleLineText', dbFieldName: 'title' },
    { id: amountId, name: 'Amount', type: 'number', dbFieldName: 'amount' },
    { id: floatId, name: 'Float', type: 'number', dbFieldName: 'floating' },
    { id: payloadId, name: 'Payload', type: 'attachment', dbFieldName: 'payload' },
    { id: dueId, name: 'Due', type: 'date', dbFieldName: 'due' },
    {
      id: ownerId,
      name: 'Owner',
      type: 'link',
      dbFieldName: 'owner',
      options: {
        relationship: 'manyOne',
        foreignTableId: targetId,
        lookupFieldId: titleId,
        isOneWay: true,
        fkHostTableName: 'public.distinct_root',
        selfKeyName: '__id',
        foreignKeyName: 'fk_owner',
      },
    },
    {
      id: itemsId,
      name: 'Items',
      type: 'link',
      dbFieldName: 'items',
      options: {
        relationship: 'oneMany',
        foreignTableId: targetId,
        lookupFieldId: titleId,
        isOneWay: false,
        fkHostTableName: 'public.distinct_target',
        selfKeyName: 'fk_root',
        foreignKeyName: '__id',
      },
    },
  ],
  views: [{ id: `viw${'a'.repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
});
const targetDto = (): ITablePersistenceDTO => ({
  ...rootDto(),
  id: targetId,
  name: 'Target',
  dbTableName: 'public.distinct_target',
  fields: rootDto().fields.slice(0, 2),
});
const definition = (select: unknown[], extra: Record<string, unknown> = {}) =>
  DataQueryDefinition.create({
    version: 6,
    kind: 'records',
    tableId: rootId,
    distinct: true,
    select,
    page: { limit: 100, includeTotal: true },
    ...extra,
  })._unsafeUnwrap();

describe('V6 finalized records DISTINCT on PGlite', () => {
  let database: PGliteTestDb;
  let root: Table;
  let target: Table;
  let executor: PostgresDataQueryExecutor;
  beforeEach(async () => {
    database = await createPGliteDb();
    root = mapper.toDomain(rootDto())._unsafeUnwrap();
    target = mapper.toDomain(targetDto())._unsafeUnwrap();
    executor = new PostgresDataQueryExecutor(database.db);
    await sql`create table distinct_root (
      __id text primary key, title text, amount numeric, floating double precision,
      payload jsonb, due timestamptz, owner jsonb, items jsonb, fk_owner text,
      __created_time timestamptz, __auto_number bigint, __version integer default 1
    )`.execute(database.db);
    await sql`create table distinct_target (__id text primary key, title text, amount numeric, fk_root text)`.execute(
      database.db
    );
  });
  afterEach(async () => {
    await database.db.destroy();
  });
  const run = async (
    select: unknown[],
    extra: Record<string, unknown> = {},
    scope: RecordQueryPluginScope = {}
  ) => {
    const bound = definition(select, extra).bind({})._unsafeUnwrap();
    return (await executor.execute(context, root, bound, scope))._unsafeUnwrap();
  };
  const relation = async (
    select: unknown[],
    extra: Record<string, unknown> = {},
    scopes: ReadonlyMap<string, RecordQueryPluginScope> = new Map()
  ) => {
    const input = definition(select, {
      relations: {
        owner: { linkFieldId: ownerId, tableId: targetId },
        items: { linkFieldId: itemsId, tableId: targetId },
      },
      ...extra,
    });
    const binding = DataQueryRelationBinding.prepare(
      input,
      root,
      new Map([
        ['owner', target],
        ['items', target],
      ])
    )._unsafeUnwrap();
    return (
      await executor.executeRelation(context, {
        query: input.bind({})._unsafeUnwrap(),
        rootTable: root,
        rootScope: {},
        plan: binding.plan,
        sources: binding.sources.map((source) => ({
          alias: source.alias,
          table: target,
          linkFieldId: source.linkFieldId,
          scope: scopes.get(source.alias) ?? {},
        })),
      })
    )._unsafeUnwrap();
  };

  it('executes finalized tuples and later-page totals with the migrated legacy validator', async () => {
    await sql`CREATE FUNCTION public.teable_try_cast_valid(text, text)
      RETURNS boolean LANGUAGE SQL AS 'SELECT false'`.execute(database.db);
    await sql
      .raw(
        readFileSync(
          new URL(
            '../../../../../db-main-prisma/prisma/postgres/migrations/20260907111000_extend_try_cast_double_precision/migration.sql',
            import.meta.url
          ),
          'utf8'
        )
      )
      .execute(database.db);
    const values = [
      '{"n":1e1000}',
      '{"n":null}',
      '{"n":1e-1000}',
      '{"n":0}',
      '{"n":1.0000000000000000001}',
      '{"n":1}',
    ];
    for (const [index, value] of values.entries())
      await sql`insert into distinct_root (__id, payload) values (${String(index)}, ${value}::jsonb)`.execute(
        database.db
      );
    const legacy = new PostgresDataQueryExecutor(database.db, {
      typeValidationStrategy: new PgLegacyTypeValidationStrategy(),
    });
    const input = definition([{ fieldId: payloadId, alias: 'payload' }]);
    const result = (
      await legacy.execute(context, root, input.bind({})._unsafeUnwrap(), {})
    )._unsafeUnwrap();
    expect(result.rows).toEqual([
      { payload: { n: null } },
      { payload: { n: 0 } },
      { payload: { n: 1 } },
    ]);
    expect(result.page).toEqual({ limit: 100, offset: 0, total: 3 });
    const empty = definition([{ fieldId: payloadId, alias: 'payload' }], {
      page: { limit: 1, offset: 99, includeTotal: true },
    });
    const later = (
      await legacy.execute(context, root, empty.bind({})._unsafeUnwrap(), {})
    )._unsafeUnwrap();
    expect(later.rows).toEqual([]);
    expect(later.page).toEqual({ limit: 1, offset: 99, total: 3 });
  });
  it('deduplicates the entire tuple, keeps selected identities and counts later empty pages', async () => {
    await sql`insert into distinct_root (__id,title,floating) values ('a','same',1),('b','same',1),('c','same',2),('d',null,2),('e',null,2)`.execute(
      database.db
    );
    const select = [
      { fieldId: titleId, alias: 'title' },
      { fieldId: floatId, alias: 'amount' },
    ];
    const result = await run(select);
    expect(result.rows).toEqual([
      { title: null, amount: 2 },
      { title: 'same', amount: 1 },
      { title: 'same', amount: 2 },
    ]);
    expect(result.page?.total).toBe(3);
    expect((await run([...select, { system: 'id', alias: 'id' }])).page?.total).toBe(5);
    const empty = await run(select, { page: { limit: 1, offset: 99, includeTotal: true } });
    expect(empty).toEqual({ rows: [], page: { limit: 1, offset: 99, total: 3 } });
    const descending = await run(select, {
      sort: [
        { alias: 'title', order: 'desc' },
        { alias: 'amount', order: 'desc' },
      ],
    });
    expect(descending.rows).toEqual([
      { title: 'same', amount: 2 },
      { title: 'same', amount: 1 },
      { title: null, amount: 2 },
    ]);
  });

  it('uses selected formula values, preserving source numeric scales and float rounding boundaries', async () => {
    await sql`insert into distinct_root (__id,amount) values ('a',1.0),('b',1.00),('c',9007199254740992),('d',9007199254740993)`.execute(
      database.db
    );
    expect((await run([{ fieldId: amountId, alias: 'value' }])).rows).toEqual([
      { value: '1.0' },
      { value: '1.00' },
      { value: '9007199254740992' },
      { value: '9007199254740993' },
    ]);
    const expr = {
      type: 'formula',
      formula: '{amount}',
      references: { amount: { type: 'field', fieldId: amountId } },
    };
    expect((await run([{ expr, alias: 'value' }])).rows).toEqual([
      { value: 1 },
      { value: 9007199254740992 },
    ]);
    expect(
      (
        await run([
          { expr: { type: 'formula', formula: '"1"', references: {} }, alias: 'text' },
          { expr: { type: 'formula', formula: '1', references: {} }, alias: 'number' },
        ])
      ).rows
    ).toEqual([{ text: '1', number: 1 }]);
  });

  it('normalizes recursive JSON number leaves, object keys, empty/escaped containers and ordered arrays', async () => {
    for (const [id, payload] of [
      ['a', '{"b":[9007199254740993,{"x":1e1000,"tiny":1e-1000}],"a":"quote\\\"\\n"}'],
      ['b', '{"a":"quote\\\"\\n","b":[9007199254740992,{"tiny":0,"x":null}]}'],
      ['c', '[1,2]'],
      ['d', '[2,1]'],
      ['e', '[]'],
      ['f', '{}'],
      ['g', 'null'],
    ])
      await sql`insert into distinct_root (__id,payload) values (${id},${payload}::jsonb)`.execute(
        database.db
      );
    await sql`insert into distinct_root (__id,payload) values ('h',null)`.execute(database.db);
    const result = await run([{ fieldId: payloadId, alias: 'value' }]);
    expect(result.page?.total).toBe(6);
    expect(result.rows).toEqual(
      expect.arrayContaining([
        { value: null },
        { value: [] },
        { value: {} },
        { value: [1, 2] },
        { value: [2, 1] },
        { value: { a: 'quote"\n', b: [9007199254740992, { x: null, tiny: 0 }] } },
      ])
    );
  });

  it('finalizes JSON scalar extremes at actual float rounding boundaries without narrowing text', async () => {
    for (const [id, payload] of [
      ['a', '1e1000'],
      ['b', 'null'],
      ['c', '1e-1000'],
      ['d', '0'],
      ['e', '"Infinity"'],
      ['f', '1.7976931348623158e308'],
      ['g', '1.7976931348623159e308'],
      ['h', '2.4703282292062328e-324'],
      ['i', '2.4703282292062327e-324'],
    ])
      await sql`insert into distinct_root (__id,payload) values (${id},${payload}::jsonb)`.execute(
        database.db
      );
    const result = await run([{ fieldId: payloadId, alias: 'value' }]);
    expect(result.rows).toEqual(
      expect.arrayContaining([
        { value: null },
        { value: 0 },
        { value: Number.MAX_VALUE },
        { value: Number.MIN_VALUE },
        { value: 'Infinity' },
      ])
    );
    expect(result.page?.total).toBe(5);
  });

  it('truncates actual timestamps before equality, retains native int8 strings and unifies nonfinite float nulls', async () => {
    await sql`insert into distinct_root (__id,due,__auto_number,floating) values
      ('a','2026-01-01T00:00:00.000001Z',1,'NaN'),
      ('b','2026-01-01T00:00:00.000999Z',9007199254740993,'Infinity'),
      ('c','2026-01-01T00:00:00.001000Z',9007199254740992,'-Infinity'),
      ('d',null,null,null)`.execute(database.db);
    expect((await run([{ fieldId: dueId, alias: 'value' }])).rows).toEqual([
      { value: null },
      { value: '2026-01-01T00:00:00.000Z' },
      { value: '2026-01-01T00:00:00.001Z' },
    ]);
    expect((await run([{ system: 'autoNumber', alias: 'value' }])).rows).toEqual([
      { value: null },
      { value: '1' },
      { value: '9007199254740992' },
      { value: '9007199254740993' },
    ]);
    expect((await run([{ fieldId: floatId, alias: 'value' }])).rows).toEqual([{ value: null }]);
  });

  it('sorts Unicode text with C collation and resolves parameterized projected sorts', async () => {
    const texts = ['é', 'e\u0301', 'Z', 'a', '😀'];
    for (const [index, title] of texts.entries())
      await sql`insert into distinct_root (__id,title) values (${String(index)},${title})`.execute(
        database.db
      );
    const input = definition([{ fieldId: titleId, alias: 'caption' }], {
      parameters: { by: { type: 'string' }, dir: { type: 'string' } },
      sort: [
        {
          field: { type: 'parameter', name: 'by' },
          order: { type: 'parameter', name: 'dir' },
          allowed: [{ fieldId: titleId }],
        },
      ],
    });
    const bound = input.bind({ by: titleId, dir: 'asc' })._unsafeUnwrap();
    expect((await executor.execute(context, root, bound, {}))._unsafeUnwrap().rows).toEqual(
      ['Z', 'a', 'e\u0301', 'é', '😀'].map((caption) => ({ caption }))
    );
  });

  it('applies scope and conditional masks before tuple collapse and exact total', async () => {
    await sql`insert into distinct_root (__id,title,floating) values ('a','hidden-a',-1),('b','hidden-b',-2),('c','visible',1),('d','excluded',99)`.execute(
      database.db
    );
    const scope = {
      recordSpec: buildRecordConditionSpec(root, {
        fieldId: floatId,
        operator: 'isLess',
        value: 99,
      })._unsafeUnwrap(),
      fieldMasks: [
        {
          fieldId: titleId,
          visibleWhen: buildRecordConditionSpec(root, {
            fieldId: floatId,
            operator: 'isGreater',
            value: 0,
          })._unsafeUnwrap(),
        },
      ],
    };
    expect(await run([{ fieldId: titleId, alias: 'value' }], {}, scope)).toEqual({
      rows: [{ value: null }, { value: 'visible' }],
      page: { limit: 100, offset: 0, total: 2 },
    });
    const formula = {
      type: 'formula',
      formula: 'LOWER({title})',
      references: { title: { type: 'field', fieldId: titleId } },
    };
    expect((await run([{ expr: formula, alias: 'value' }], {}, scope)).rows).toEqual([
      { value: null },
      { value: 'visible' },
    ]);
  });

  it('deduplicates authorized to-one and per-root relation metric outputs including later-page totals', async () => {
    await sql`insert into distinct_root (__id,fk_owner) values ('a','owner1'),('b','owner2'),('c',null),('d',null)`.execute(
      database.db
    );
    await sql`insert into distinct_target (__id,title,amount,fk_root) values
      ('owner1','same',null,null),('owner2','same',null,null),
      ('item1','item',2,'a'),('item2','item',2,'b')`.execute(database.db);
    const select = [
      { source: 'owner', fieldId: titleId, alias: 'owner' },
      { source: 'items', fieldId: amountId, statisticFunc: 'sum', alias: 'sum' },
    ];
    const result = await relation(select);
    expect(result.rows).toEqual([
      { owner: null, sum: null },
      { owner: 'same', sum: 2 },
    ]);
    expect(result.page?.total).toBe(2);
    expect(
      (await relation(select, { page: { limit: 1, offset: 99, includeTotal: true } })).page?.total
    ).toBe(2);
    const scopes = new Map([
      [
        'owner',
        {
          recordSpec: buildRecordConditionSpec(target, {
            fieldId: titleId,
            operator: 'is',
            value: 'not-visible',
          })._unsafeUnwrap(),
        },
      ],
    ]);
    expect(
      (await relation([{ source: 'owner', fieldId: titleId, alias: 'value' }], {}, scopes)).rows
    ).toEqual([{ value: null }]);
    expect(
      (await relation(select, { filter: { relation: 'items', quantifier: 'any' } })).rows
    ).toEqual([{ owner: 'same', sum: 2 }]);
  });

  it('classifies numeric metric values after rounding and preserves unsafe scale and overflow text', async () => {
    const amounts = [
      '9007199254740991.1',
      '9007199254740991.5',
      '9007199254740993.0',
      '1e1000',
      '1e-1000',
    ];
    for (const [index, amount] of amounts.entries()) {
      const id = String(index);
      await sql`insert into distinct_root (__id) values (${id})`.execute(database.db);
      await sql`insert into distinct_target (__id,title,amount,fk_root) values (${`item${id}`},'item',${amount}::numeric,${id})`.execute(
        database.db
      );
    }
    const result = await relation([
      { source: 'items', fieldId: amountId, statisticFunc: 'sum', alias: 'value' },
    ]);
    expect(result.rows).toEqual(
      expect.arrayContaining([
        { value: 9007199254740991 },
        { value: '9007199254740991.5' },
        { value: '9007199254740993.0' },
        { value: 0 },
      ])
    );
    expect(
      result.rows.some((row) => typeof row.value === 'string' && row.value.length > 1000)
    ).toBe(true);
    expect(result.page?.total).toBe(5);
  });
});
