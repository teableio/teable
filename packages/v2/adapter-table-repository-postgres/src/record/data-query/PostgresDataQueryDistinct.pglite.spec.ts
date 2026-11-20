import { readFileSync } from 'node:fs';

import {
  ActorId,
  buildRecordConditionSpec,
  DefaultTableMapper,
  LookupField,
  type ITablePersistenceDTO,
  type RecordQueryPluginScope,
  type Table,
} from '@teable/v2-core';
import {
  DataQueryDefinition,
  DataQueryRelationBinding,
  type DataQueryResult,
} from '@teable/v2-data-query';
import {
  Pg16TypeValidationStrategy,
  PgLegacyTypeValidationStrategy,
} from '@teable/v2-formula-sql-pg';
import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createPGliteDb,
  type PGliteTestDb,
} from '../../schema/visitors/__tests__/helpers/createPGliteDb';
import { PostgresDataQueryExecutor } from './PostgresDataQueryExecutor';
import { compileCursorRecords, finishCursorRecords } from './compileCursorRecords';

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
    {
      id: titleId,
      name: 'Title',
      type: 'singleLineText',
      dbFieldName: 'title',
      dbFieldType: 'TEXT',
    },
    { id: amountId, name: 'Amount', type: 'number', dbFieldName: 'amount', dbFieldType: 'REAL' },
    { id: floatId, name: 'Float', type: 'number', dbFieldName: 'floating', dbFieldType: 'REAL' },
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
const definition = (select: unknown[], extra: Record<string, unknown> = {}) => {
  const result = DataQueryDefinition.create({
    version: 6,
    kind: 'records',
    tableId: rootId,
    distinct: true,
    select,
    page: { limit: 100, includeTotal: true },
    ...extra,
  });
  if (result.isErr()) throw new Error(`definition: ${JSON.stringify(result.error)}`);
  return result.value;
};

describe('V6 finalized records DISTINCT on PGlite', () => {
  let database: PGliteTestDb;
  let root: Table;
  let target: Table;
  let executor: PostgresDataQueryExecutor;
  beforeEach(async () => {
    database = await createPGliteDb();
    root = mapper.toDomain(rootDto())._unsafeUnwrap();
    target = mapper.toDomain(targetDto())._unsafeUnwrap();
    executor = new PostgresDataQueryExecutor(database.db, {
      cursorSigningKey: 'test-cursor-signing-key',
    });
    await sql`create table distinct_root (
      __id text primary key, title text, amount numeric, floating double precision,
      payload jsonb, due timestamptz, owner jsonb, items jsonb, fk_owner text,
      __created_time timestamptz, __auto_number serial, __version integer default 1
    )`.execute(database.db);
    await sql`create table distinct_target (
      __id text primary key, title text, amount numeric, fk_root text, __auto_number serial
    )`.execute(database.db);
  });
  afterEach(async () => {
    await database.db.destroy();
  });
  const run = async (
    select: unknown[],
    extra: Record<string, unknown> = {},
    scope: RecordQueryPluginScope = {}
  ) => {
    const bound = definition(select, extra).bind({});
    if (bound.isErr()) throw new Error(`root binding: ${JSON.stringify(bound.error)}`);
    const result = await executor.execute(context, root, bound.value, scope);
    if (result.isErr()) throw new Error(`root execution: ${JSON.stringify(result.error)}`);
    return result.value;
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
    const prepared = DataQueryRelationBinding.prepare(
      input,
      root,
      new Map([
        ['owner', target],
        ['items', target],
      ])
    );
    if (prepared.isErr()) throw new Error(`relation binding: ${JSON.stringify(prepared.error)}`);
    const binding = prepared.value;
    const query = input.bind({});
    if (query.isErr()) throw new Error(`relation query binding: ${JSON.stringify(query.error)}`);
    const result = await executor.executeRelation(context, {
      query: query.value,
      rootTable: root,
      rootScope: {},
      plan: binding.plan,
      sources: binding.sources.map((source) => ({
        alias: source.alias,
        table: target,
        linkFieldId: source.linkFieldId,
        scope: scopes.get(source.alias) ?? {},
      })),
    });
    if (result.isErr()) throw new Error(`relation execution: ${JSON.stringify(result.error)}`);
    return result.value;
  };

  it.each(['asc', 'desc'] as const)(
    'pages V7 finalized DISTINCT %s tuples without leaking cursor columns',
    async (order) => {
      await sql`insert into distinct_root (__id,title,floating) values
      ('a','same',1),('b','same',1),('c','same',2),('d',null,2),('e',null,2),('f','other',3)`.execute(
        database.db
      );
      const input = definition(
        [
          { fieldId: titleId, alias: '__dq_cursor_values' },
          { fieldId: floatId, alias: 'amount' },
        ],
        {
          version: 7,
          parameters: { cursor: { type: 'string' } },
          sort: [{ alias: '__dq_cursor_values', order, nulls: 'last' }],
          page: { limit: 1, after: { type: 'parameter', name: 'cursor' }, includeTotal: true },
        }
      );
      const expected =
        order === 'asc'
          ? [
              { __dq_cursor_values: 'other', amount: 3 },
              { __dq_cursor_values: 'same', amount: 1 },
              { __dq_cursor_values: 'same', amount: 2 },
              { __dq_cursor_values: null, amount: 2 },
            ]
          : [
              { __dq_cursor_values: 'same', amount: 1 },
              { __dq_cursor_values: 'same', amount: 2 },
              { __dq_cursor_values: 'other', amount: 3 },
              { __dq_cursor_values: null, amount: 2 },
            ];
      const rows: unknown[] = [];
      let cursor: string | undefined;
      for (let index = 0; index < 4; index++) {
        const bound = input.bind(cursor ? { cursor } : {});
        if (bound.isErr()) throw new Error(`bind: ${JSON.stringify(bound.error)}`);
        const executed = await executor.execute(context, root, bound.value, {});
        if (executed.isErr())
          throw new Error(
            `execute page ${index} cursor=${cursor ?? '<first>'}: ${JSON.stringify(executed.error)}`
          );
        const result = executed.value;
        expect(result.page?.total).toBe(4);
        expect(result.page).not.toHaveProperty('offset');
        rows.push(...result.rows);
        const next = result.page && 'nextCursor' in result.page ? result.page.nextCursor : null;
        expect(next).toEqual(index === 3 ? null : expect.any(String));
        cursor = next ?? undefined;
      }
      expect(rows).toEqual(expected);
    }
  );

  it('preserves exact numeric and microsecond timestamp order across page boundaries', async () => {
    await sql`insert into distinct_root (__id,title,amount,due) values
      ('a','A',2,'2026-01-01T00:00:00.000001Z'),('b','B',10,'2026-01-01T00:00:00.000999Z'),
      ('c','C',9007199254740993,'2026-01-01T00:00:00.000001Z'),('d','D',9007199254740992,null)`.execute(
      database.db
    );
    for (const [sort, expected] of [
      [[{ fieldId: amountId, order: 'asc' }], ['A', 'B', 'D', 'C']],
      [[{ fieldId: dueId, order: 'asc', nulls: 'last' }], ['A', 'C', 'B', 'D']],
    ] as const) {
      const input = DataQueryDefinition.create({
        version: 7,
        kind: 'records',
        tableId: rootId,
        select: [{ fieldId: titleId, alias: 'title' }],
        sort,
        parameters: { cursor: { type: 'string' } },
        page: { limit: 1, after: { type: 'parameter', name: 'cursor' } },
      })._unsafeUnwrap();
      const offset = DataQueryDefinition.create({
        version: 6,
        kind: 'records',
        tableId: rootId,
        select: [{ fieldId: titleId, alias: 'title' }],
        sort,
        page: { limit: 4 },
      })._unsafeUnwrap();
      const baseline = (await executor.execute(context, root, offset.bind({})._unsafeUnwrap(), {}))
        ._unsafeUnwrap()
        .rows.map((row) => row.title);
      expect(baseline).toEqual(expected);
      const seen: unknown[] = [];
      let cursor: string | undefined;
      for (let index = 0; index < 4; index++) {
        const result = (
          await executor.execute(
            context,
            root,
            input.bind(cursor ? { cursor } : {})._unsafeUnwrap(),
            {}
          )
        )._unsafeUnwrap();
        seen.push(result.rows[0]?.title);
        expect(Object.keys(result.rows[0])).toEqual(['title']);
        expect(result.page).not.toHaveProperty('total');
        cursor =
          result.page && 'nextCursor' in result.page
            ? (result.page.nextCursor ?? undefined)
            : undefined;
      }
      expect(seen).toEqual(baseline);
      expect(cursor).toBeUndefined();
    }
  });

  it.each([true, false])(
    'traverses 101 projections and null tuples with distinct=%s',
    async (distinct) => {
      await sql`insert into distinct_root (__id,title) values
      ('a',null),('b',null),('c','A'),('d','A')`.execute(database.db);
      const select = Array.from({ length: 101 }, (_, index) => ({
        fieldId: titleId,
        alias: `value_${index}`,
      }));
      const sort = [{ alias: 'value_0', order: 'asc', nulls: 'first' }];
      const canonical = await run(select, { distinct: distinct ? true : undefined, sort });
      const input = definition(select, {
        version: 7,
        distinct: distinct ? true : undefined,
        sort,
        parameters: { cursor: { type: 'string' } },
        page: {
          limit: distinct ? 1 : 2,
          after: { type: 'parameter', name: 'cursor' },
          includeTotal: true,
        },
      });
      const empty = Object.fromEntries(select.map(({ alias }) => [alias, null]));
      const nonempty = Object.fromEntries(select.map(({ alias }) => [alias, 'A']));
      const firstResult = await executor.execute(context, root, input.bind({})._unsafeUnwrap(), {});
      if (firstResult.isErr())
        throw new Error(`First wide page failed: ${firstResult.error.message}`);
      const first = firstResult.value;
      expect(first.rows).toEqual(distinct ? [empty] : [empty, empty]);
      expect(first.page?.total).toBe(distinct ? 2 : 4);
      const cursor = first.page && 'nextCursor' in first.page ? first.page.nextCursor : null;
      expect(cursor).toEqual(expect.any(String));
      const nextResult = await executor.execute(
        context,
        root,
        input.bind({ cursor })._unsafeUnwrap(),
        {}
      );
      if (nextResult.isErr())
        throw new Error(`Wide continuation failed: ${nextResult.error.message}`);
      const next = nextResult.value;
      expect(next.rows).toEqual(distinct ? [nonempty] : [nonempty, nonempty]);
      expect(next.page?.total).toBe(distinct ? 2 : 4);
      expect(next.page && 'nextCursor' in next.page ? next.page.nextCursor : undefined).toBeNull();
      expect([...first.rows, ...next.rows]).toEqual(canonical.rows);
      expect(first.page?.total).toBe(canonical.page?.total);
    }
  );

  it('requires a configured key on every V7 page while V6 remains usable without one', async () => {
    await sql`insert into distinct_root (__id,title) values ('a','A'),('b','B')`.execute(
      database.db
    );
    const input = definition([{ fieldId: titleId, alias: 'title' }], {
      version: 7,
      distinct: undefined,
      parameters: { cursor: { type: 'string' } },
      page: { limit: 1, after: { type: 'parameter', name: 'cursor' } },
    });
    const first = (
      await executor.execute(context, root, input.bind({})._unsafeUnwrap(), {})
    )._unsafeUnwrap();
    const cursor = first.page && 'nextCursor' in first.page ? first.page.nextCursor : null;
    expect(cursor).toEqual(expect.any(String));
    const noKey = new PostgresDataQueryExecutor(database.db);
    for (const parameters of [{}, { cursor }]) {
      const query = input.bind(parameters)._unsafeUnwrap();
      expect(noKey.compile(context, root, query, {})._unsafeUnwrapErr()).toMatchObject({
        code: 'data_query.cursor_not_configured',
      });
      expect((await noKey.execute(context, root, query, {}))._unsafeUnwrapErr()).toMatchObject({
        code: 'data_query.cursor_not_configured',
      });
    }
    const legacy = definition([{ fieldId: titleId, alias: 'title' }], {
      distinct: undefined,
      page: { limit: 1 },
    })
      .bind({})
      ._unsafeUnwrap();
    expect((await noKey.execute(context, root, legacy, {}))._unsafeUnwrap().rows).toEqual([
      { title: 'A' },
    ]);
  });

  it('pages ordinary masked field, alias and expression sorts with pre-cursor authorized totals', async () => {
    await sql`insert into distinct_root (__id,title,floating,payload) values
      ('a','hidden Z',-1,'[{"n":1.0000000000000000001}]'::jsonb),
      ('b','B',1,'[{"n":1}]'::jsonb),('c','b',2,'[{"n":1}]'::jsonb),
      ('d',null,3,'[{"n":1}]'::jsonb),('e','excluded',99,'[{"n":1}]'::jsonb)`.execute(database.db);
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
    for (const target of ['field', 'alias', 'expression'] as const) {
      for (const order of ['asc', 'desc'] as const) {
        const input = definition(
          [
            { system: 'id', alias: 'id' },
            { fieldId: titleId, alias: 'title' },
            { fieldId: payloadId, alias: 'payload' },
            {
              expr: {
                type: 'formula',
                formula: 'LOWER({title})',
                references: { title: { type: 'field', fieldId: titleId } },
              },
              alias: 'lowered',
            },
          ],
          {
            version: 7,
            distinct: undefined,
            sort: [
              {
                ...(target === 'field'
                  ? { fieldId: titleId }
                  : { alias: target === 'alias' ? 'title' : 'lowered' }),
                order,
                nulls: order === 'asc' ? 'first' : 'last',
              },
            ],
            parameters: { cursor: { type: 'string' } },
            page: { limit: 1, after: { type: 'parameter', name: 'cursor' }, includeTotal: true },
          }
        );
        const expected =
          order === 'asc'
            ? ['a', 'd', 'b', 'c']
            : target === 'expression'
              ? ['b', 'c', 'a', 'd']
              : ['c', 'b', 'a', 'd'];
        const seen: unknown[] = [];
        let cursor: string | undefined;
        for (let index = 0; index < expected.length; index++) {
          const result = (
            await executor.execute(
              context,
              root,
              input.bind(cursor ? { cursor } : {})._unsafeUnwrap(),
              scope
            )
          )._unsafeUnwrap();
          expect(result.page?.total).toBe(4);
          expect(result.rows[0].payload).toEqual([{ n: 1 }]);
          if (result.rows[0].id === 'a' || result.rows[0].id === 'd') {
            expect(result.rows[0].title).toBeNull();
            expect(result.rows[0].lowered).toBeNull();
          }
          seen.push(result.rows[0].id);
          cursor =
            result.page && 'nextCursor' in result.page
              ? (result.page.nextCursor ?? undefined)
              : undefined;
        }
        expect(seen).toEqual(expected);
        expect(cursor).toBeUndefined();
      }
    }
  });

  it('matches V6 native numeric and float specials, exact finite keys and nulls', async () => {
    await sql`insert into distinct_root (__id,amount,floating) values
      ('a','-Infinity'::numeric,'-Infinity'::float8),
      ('b','Infinity'::numeric,'Infinity'::float8),
      ('c','NaN'::numeric,'NaN'::float8),('d',2,2),('e',10,10),
      ('f',9007199254740993,9007199254740992),
      ('g',9007199254740992,9007199254740992),('h',null,null)`.execute(database.db);
    const strategy = new Pg16TypeValidationStrategy();
    for (const [rawType, expression, numeric] of [
      ['numeric', sql`t.amount`, true],
      ['number', sql`t.amount`, true],
      ['number', sql`t.floating`, false],
      ['double precision', sql`t.floating`, false],
      ['real', sql`t.floating::real`, false],
    ] as const) {
      for (const direction of ['asc', 'desc'] as const) {
        const input = definition([{ system: 'id', alias: 'id' }], {
          version: 7,
          distinct: undefined,
          sort: [
            {
              fieldId: numeric ? amountId : floatId,
              order: direction,
              nulls: direction === 'asc' ? 'first' : 'last',
            },
          ],
          parameters: { cursor: { type: 'string' } },
          page: { limit: 1, after: { type: 'parameter', name: 'cursor' } },
        });
        const expected = (
          await run([{ system: 'id', alias: 'id' }], {
            distinct: undefined,
            sort: [
              {
                fieldId: numeric ? amountId : floatId,
                order: direction,
                nulls: direction === 'asc' ? 'first' : 'last',
              },
            ],
          })
        ).rows.map(({ id }) => id);
        let cursor: string | undefined;
        const seen: unknown[] = [];
        for (let index = 0; index < expected.length; index++) {
          const query = input.bind(cursor ? { cursor } : {})._unsafeUnwrap();
          let result: DataQueryResult;
          if (rawType === 'number') {
            // Both fields carry persisted REAL metadata, but amount is native
            // numeric and floating is float8: the executor must preserve both.
            result = (await executor.execute(context, root, query, {}))._unsafeUnwrap();
          } else {
            const compiled = compileCursorRecords(
              database.db,
              sql`from distinct_root as t`,
              [{ alias: 'id', expression: sql`t.__id`, metric: false, storageType: 'text' }],
              sql`t.__id`,
              [
                {
                  expression,
                  direction,
                  nulls: direction === 'asc' ? 'first' : 'last',
                },
              ],
              false,
              query,
              `native-${rawType}-${numeric}-${direction}`,
              strategy,
              'sql',
              'test-cursor-signing-key'
            )._unsafeUnwrap();
            const executed = await database.db.executeQuery(compiled.rows);
            result = finishCursorRecords(
              executed.rows,
              query,
              compiled.cursor,
              undefined,
              'test-cursor-signing-key'
            )._unsafeUnwrap();
          }
          seen.push(result.rows[0].id);
          cursor =
            result.page && 'nextCursor' in result.page
              ? (result.page.nextCursor ?? undefined)
              : undefined;
        }
        expect(seen).toEqual(expected);
        expect(cursor).toBeUndefined();
      }
    }
  });

  it.each(
    (['asc', 'desc'] as const).flatMap((secondaryDirection) =>
      [1, 3, 4].map((limit) => ({ secondaryDirection, limit }))
    )
  )(
    'preserves native numeric-family special ties with $secondaryDirection secondary keys, page size $limit and both null placements',
    async ({ secondaryDirection, limit }) => {
      const samples = [null, '-Infinity', 'Infinity', 'NaN', '2', '3'].flatMap((value, group) =>
        Array.from({ length: 4 }, (_, offset) => {
          const index = group * 4 + offset;
          return {
            id: `r${String(index).padStart(2, '0')}`,
            title: offset === 3 ? null : offset === 1 ? 'B' : 'A',
            value,
          };
        })
      );
      for (const sample of samples) {
        await sql`insert into distinct_root (__id,title,amount,floating)
        values (${sample.id},${sample.title},${sample.value}::numeric,${sample.value}::float8)`.execute(
          database.db
        );
      }
      for (const numeric of [true, false]) {
        for (const direction of ['asc', 'desc'] as const) {
          for (const nulls of ['first', 'last'] as const) {
            const secondaryNulls = nulls === 'first' ? 'last' : 'first';
            const input = definition([{ system: 'id', alias: 'id' }], {
              version: 7,
              distinct: undefined,
              sort: [
                { fieldId: numeric ? amountId : floatId, order: direction, nulls },
                { fieldId: titleId, order: secondaryDirection, nulls: secondaryNulls },
              ],
              parameters: { cursor: { type: 'string' } },
              page: { limit, after: { type: 'parameter', name: 'cursor' }, includeTotal: true },
            });
            const expected = (
              await run([{ system: 'id', alias: 'id' }], {
                distinct: undefined,
                sort: [
                  { fieldId: numeric ? amountId : floatId, order: direction, nulls },
                  { fieldId: titleId, order: secondaryDirection, nulls: secondaryNulls },
                ],
              })
            ).rows.map(({ id }) => id);
            const seen: unknown[] = [];
            let cursor: string | undefined;
            for (let page = 0; page < samples.length / limit; page++) {
              const query = input.bind(cursor ? { cursor } : {})._unsafeUnwrap();
              const result = (await executor.execute(context, root, query, {}))._unsafeUnwrap();
              if (direction === 'desc' && nulls === 'last') {
                // Diagnostic compilation and transaction execution share the V6 keys.
                const compiled = executor.compile(context, root, query, {})._unsafeUnwrap();
                const generic = await database.db.executeQuery(compiled);
                expect(generic.rows.slice(0, limit).map(({ id }) => id)).toEqual(
                  result.rows.map(({ id }) => id)
                );
              }
              expect(result.page?.total).toBe(samples.length);
              seen.push(...result.rows.map(({ id }) => id));
              cursor =
                result.page && 'nextCursor' in result.page
                  ? (result.page.nextCursor ?? undefined)
                  : undefined;
            }
            expect(seen).toEqual(expected);
            expect(cursor).toBeUndefined();
          }
        }
      }
    }
  );

  it('matches V6 relation numeric specials and exact secondary keys', async () => {
    const samples = [null, '-Infinity', 'Infinity', 'NaN', '9007199254740992', '9007199254740993'];
    for (let index = 0; index < samples.length * 2; index++) {
      const id = `r${index}`;
      await sql`insert into distinct_root (__id,title,fk_owner)
        values (${id},${index % 2 ? 'Z' : 'a'},${id})`.execute(database.db);
      await sql`insert into distinct_target (__id,title,amount)
        values (${id},${id},${samples[Math.floor(index / 2)]}::numeric)`.execute(database.db);
    }
    const select = [
      { system: 'id', alias: 'id' },
      { source: 'owner', fieldId: amountId, alias: 'amount' },
    ];
    for (const order of ['asc', 'desc'] as const) {
      for (const nulls of ['first', 'last'] as const) {
        const extra = {
          distinct: undefined,
          relations: { owner: { linkFieldId: ownerId, tableId: targetId } },
          sort: [
            { source: 'owner', fieldId: amountId, order, nulls },
            { fieldId: titleId, order: 'desc', nulls: 'last' },
          ],
        };
        const expected = (await relation(select, extra)).rows;
        const input = definition(select, {
          ...extra,
          version: 7,
          parameters: { cursor: { type: 'string' } },
          page: { limit: 3, after: { type: 'parameter', name: 'cursor' }, includeTotal: true },
        });
        const binding = DataQueryRelationBinding.prepare(
          input,
          root,
          new Map([['owner', target]])
        )._unsafeUnwrap();
        const seen: unknown[] = [];
        let after: string | undefined;
        for (let page = 0; page < expected.length / 3; page++) {
          const result = (
            await executor.executeRelation(context, {
              query: input.bind(after ? { cursor: after } : {})._unsafeUnwrap(),
              rootTable: root,
              rootScope: {},
              plan: binding.plan,
              sources: [{ alias: 'owner', table: target, linkFieldId: ownerId, scope: {} }],
            })
          )._unsafeUnwrap();
          seen.push(...result.rows);
          expect(result.page?.total).toBe(expected.length);
          after =
            result.page && 'nextCursor' in result.page
              ? (result.page.nextCursor ?? undefined)
              : undefined;
        }
        expect(seen).toEqual(expected);
        expect(after).toBeUndefined();
      }
    }
  });

  it('preserves native float boundaries when session output precision is reduced', async () => {
    const previous = await sql<{
      value: string;
    }>`select current_setting('extra_float_digits') as value`.execute(database.db);
    try {
      await sql`set extra_float_digits = 0`.execute(database.db);
      await sql`insert into distinct_root (__id,floating) values
        ('a',2.0000000000000004),('z',2),('b',1.0000000000000002),('c',1)`.execute(database.db);
      for (const rawType of ['number', 'double precision', 'real'] as const) {
        if (rawType === 'real') {
          await sql`update distinct_root set floating = case __id
            when 'a' then 2.000000238418579::real else 1.0000001192092896::real end
            where __id in ('a', 'b')`.execute(database.db);
        }
        for (const direction of ['asc', 'desc'] as const) {
          const input = definition(
            [
              { system: 'id', alias: 'id' },
              { fieldId: floatId, alias: 'value' },
            ],
            {
              version: 7,
              distinct: undefined,
              sort: [{ alias: 'value', order: direction, nulls: 'first' }],
              parameters: { cursor: { type: 'string' } },
              page: { limit: 1, after: { type: 'parameter', name: 'cursor' } },
            }
          );
          const expression = rawType === 'real' ? sql`t.floating::real` : sql`t.floating`;
          const expected = (
            await sql<{ id: string }>`select t.__id as id from distinct_root t
            order by ${expression} ${sql.raw(direction)} nulls first, t.__id asc`.execute(
              database.db
            )
          ).rows.map(({ id }) => id);
          const seen: unknown[] = [];
          let cursor: string | undefined;
          for (let page = 0; page < 4; page++) {
            const query = input.bind(cursor ? { cursor } : {})._unsafeUnwrap();
            let result: DataQueryResult;
            if (rawType === 'number') {
              result = (await executor.execute(context, root, query, {}))._unsafeUnwrap();
            } else {
              const compiled = compileCursorRecords(
                database.db,
                sql`from distinct_root as t`,
                [
                  { alias: 'id', expression: sql`t.__id`, metric: false, storageType: 'text' },
                  { alias: 'value', expression, metric: false },
                ],
                sql`t.__id`,
                [{ alias: 'value', expression, direction, nulls: 'first' }],
                false,
                query,
                `reduced-precision-${rawType}-${direction}`,
                new Pg16TypeValidationStrategy(),
                'sql',
                'test-cursor-signing-key'
              )._unsafeUnwrap();
              const executed = await database.db.executeQuery(compiled.rows);
              result = finishCursorRecords(
                executed.rows,
                query,
                compiled.cursor,
                undefined,
                'test-cursor-signing-key'
              )._unsafeUnwrap();
            }
            seen.push(result.rows[0].id);
            expect([1, 2]).toContain(result.rows[0].value);
            cursor =
              result.page && 'nextCursor' in result.page
                ? (result.page.nextCursor ?? undefined)
                : undefined;
          }
          expect(seen).toEqual(expected);
          expect(cursor).toBeUndefined();
        }
      }
    } finally {
      await sql`select set_config('extra_float_digits', ${previous.rows[0].value}, false)`.execute(
        database.db
      );
    }
  });

  it.each(['real', 'double precision'] as const)(
    'preserves %s array boundaries, dimensions and nulls at reduced output precision',
    async (physicalType) => {
      await sql`set extra_float_digits = 0`.execute(database.db);
      await sql`alter table distinct_root add column float_values ${sql.raw(physicalType)}[]`.execute(
        database.db
      );
      const next = physicalType === 'real' ? '1.0000001192092896' : '1.0000000000000002';
      for (const [id, value] of [
        ['a', `{${next},NULL}`],
        ['z', '{1,NULL}'],
        ['b', '{NaN,Infinity}'],
        ['c', '{-Infinity,0}'],
        ['d', '[0:1]={1,NULL}'],
        ['e', '{{1,2},{3,4}}'],
        ['f', '{}'],
        ['g', null],
        ['h', `{${next},NULL}`],
      ]) {
        await sql`insert into distinct_root (__id,float_values)
          values (${id},${value}::${sql.raw(physicalType)}[])`.execute(database.db);
      }
      for (const direction of ['asc', 'desc'] as const) {
        for (const nulls of ['first', 'last'] as const) {
          const expected = (
            await sql<{ id: string }>`select __id as id from distinct_root
            order by float_values ${sql.raw(direction)} nulls ${sql.raw(nulls)}, __id asc`.execute(
              database.db
            )
          ).rows;
          const input = definition([{ system: 'id', alias: 'id' }], {
            version: 7,
            distinct: undefined,
            parameters: { cursor: { type: 'string' } },
            page: { limit: 1, after: { type: 'parameter', name: 'cursor' } },
          });
          const seen: unknown[] = [];
          let cursor: string | undefined;
          for (let page = 0; page < expected.length; page++) {
            const query = input.bind(cursor ? { cursor } : {})._unsafeUnwrap();
            const compiled = compileCursorRecords(
              database.db,
              sql`from distinct_root as t`,
              [{ alias: 'id', expression: sql`t.__id`, metric: false, storageType: 'text' }],
              sql`t.__id`,
              [{ expression: sql`t.float_values`, direction, nulls }],
              false,
              query,
              `float-array-${physicalType}-${direction}-${nulls}`,
              new Pg16TypeValidationStrategy(),
              'sql',
              'test-cursor-signing-key'
            )._unsafeUnwrap();
            const result = finishCursorRecords(
              (await database.db.executeQuery(compiled.rows)).rows,
              query,
              compiled.cursor,
              undefined,
              'test-cursor-signing-key'
            )._unsafeUnwrap();
            seen.push(...result.rows);
            cursor =
              result.page && 'nextCursor' in result.page
                ? (result.page.nextCursor ?? undefined)
                : undefined;
          }
          expect(seen).toEqual(expected);
          expect(cursor).toBeUndefined();
        }
      }
    }
  );

  it.each([3, 0])(
    'matches canonical public values on root and relation cursor pages at extra_float_digits=%i',
    async (precision) => {
      const previous = await sql<{
        value: string;
      }>`select current_setting('extra_float_digits') as value`.execute(database.db);
      const checkboxId = `fld${'h'.repeat(16)}`;
      const numericId = `fld${'i'.repeat(16)}`;
      const bigintId = `fld${'j'.repeat(16)}`;
      const integerId = `fld${'k'.repeat(16)}`;
      const storageFields: ITablePersistenceDTO['fields'] = [
        {
          id: checkboxId,
          name: 'Flag',
          type: 'checkbox',
          dbFieldName: 'flag',
          dbFieldType: 'BOOLEAN',
        },
        {
          id: numericId,
          name: 'Exact',
          type: 'number',
          dbFieldName: 'exact',
          dbFieldType: 'NUMERIC',
        },
        { id: bigintId, name: 'Big', type: 'number', dbFieldName: 'big', dbFieldType: 'BIGINT' },
        {
          id: integerId,
          name: 'Small',
          type: 'number',
          dbFieldName: 'small',
          dbFieldType: 'INTEGER',
        },
      ];
      const rootResult = mapper.toDomain({
        ...rootDto(),
        fields: [...rootDto().fields, ...storageFields],
      });
      if (rootResult.isErr())
        throw new Error(
          `precision ${precision} root metadata: ${JSON.stringify(rootResult.error)}`
        );
      root = rootResult.value;
      const targetResult = mapper.toDomain({
        ...targetDto(),
        fields: [
          ...targetDto().fields,
          ...storageFields.map((field) =>
            field.id === numericId ? { ...field, dbFieldType: 'REAL' } : field
          ),
        ],
      });
      if (targetResult.isErr())
        throw new Error(
          `precision ${precision} target metadata: ${JSON.stringify(targetResult.error)}`
        );
      target = targetResult.value;
      const nested =
        '{"rounded":9007199254740993,"precise":1.0000000000000002,"overflow":1e1000,"underflow":-1e-1000,"values":["Infinity",2.4703282292062328e-324],"__proto__":{"value":1e1000},"constructor":"kept","date":"2026-01-01T00:00:00.000999Z"}';
      try {
        await sql`select set_config('extra_float_digits', ${String(precision)}, false)`.execute(
          database.db
        );
        for (const tableName of ['distinct_root', 'distinct_target'])
          await sql`alter table ${sql.id(tableName)} add column flag boolean,
            add column exact numeric, add column big bigint, add column small integer`.execute(
            database.db
          );
        await sql`alter table distinct_target alter column amount type double precision`.execute(
          database.db
        );
        for (const [id, payload, flag, exact, big, small] of [
          ['a', nested, true, '9007199254740993.00', '9223372036854775807', 2147483647],
          ['b', '1e1000', false, '1e1000', '-9223372036854775808', -2147483648],
          ['c', '1.0000000000000002', null, '-1e-1000', '9007199254740993', 0],
          ['d', 'null', true, null, null, null],
        ] as const) {
          await sql`insert into distinct_root (__id,title,amount,floating,payload,due,__auto_number,
            flag,exact,big,small,fk_owner) values
            (${id},${id === 'a' ? '{"flag":true}' : null},1.00,'Infinity',${payload}::jsonb,
            '2026-01-01T00:00:00.000999Z',1,${flag},${exact}::numeric,${big}::bigint,${small},${id})`.execute(
            database.db
          );
          await sql`insert into distinct_target (__id,amount,flag,exact,big,small) values
            (${id},1.00,${flag},${exact}::numeric,${big}::bigint,${small})`.execute(database.db);
        }
        const select = [
          { system: 'id', alias: 'id' },
          { fieldId: titleId, alias: 'title' },
          { fieldId: checkboxId, alias: 'flag' },
          { fieldId: numericId, alias: 'exact' },
          { fieldId: bigintId, alias: 'big' },
          { fieldId: integerId, alias: 'small' },
          { fieldId: payloadId, alias: 'payload' },
          { fieldId: amountId, alias: 'amount' },
          { fieldId: amountId, alias: 'amount_copy' },
          { fieldId: floatId, alias: 'floating' },
          { fieldId: dueId, alias: 'due' },
          { system: 'autoNumber', alias: 'sequence' },
        ];
        const sort = [{ alias: 'id', order: 'asc', nulls: 'first' }];
        const canonical = await run(select, { sort });
        expect(canonical.rows[0]).toMatchObject({
          title: '{"flag":true}',
          flag: true,
          exact: '9007199254740993.00',
          big: '9223372036854775807',
          small: 2147483647,
          amount: '1.00',
          floating: null,
          due: '2026-01-01T00:00:00.000Z',
          sequence: 1,
        });
        expect(canonical.rows.map(({ flag }) => flag)).toEqual([true, false, null, true]);
        expect(canonical.rows[1]).toMatchObject({
          flag: false,
          big: '-9223372036854775808',
          small: -2147483648,
        });
        expect(canonical.rows[2]).toMatchObject({ flag: null, big: '9007199254740993', small: 0 });
        expect(canonical.rows[3]).toMatchObject({ exact: null, big: null, small: null });
        expect(canonical.rows[0].payload).toMatchObject(
          JSON.parse(
            `{"precise":${precision > 0 ? '1.0000000000000002' : '1'},"overflow":null,"underflow":0,"values":["Infinity",5e-324],"__proto__":{"value":null},"constructor":"kept","date":"2026-01-01T00:00:00.000999Z"}`
          )
        );
        const extra = {
          version: 7,
          distinct: undefined,
          sort,
          parameters: { cursor: { type: 'string' } },
          page: { limit: 1, after: { type: 'parameter', name: 'cursor' }, includeTotal: true },
        };
        const input = definition(select, extra);
        const seen: Record<string, unknown>[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < canonical.rows.length; page++) {
          const query = input.bind(cursor ? { cursor } : {});
          if (query.isErr())
            throw new Error(
              `precision ${precision} root page ${page} binding: ${JSON.stringify(query.error)}`
            );
          const result = await executor.execute(context, root, query.value, {});
          if (result.isErr()) throw new Error(`root page ${page}: ${JSON.stringify(result.error)}`);
          const { value } = result;
          seen.push(...value.rows);
          expect(value.page?.total).toBe(canonical.rows.length);
          cursor =
            value.page && 'nextCursor' in value.page
              ? (value.page.nextCursor ?? undefined)
              : undefined;
        }
        expect(seen).toEqual(canonical.rows);
        expect(cursor).toBeUndefined();
        const relatedSelect = [
          ...select,
          { source: 'owner', fieldId: checkboxId, alias: 'owner_flag' },
          { source: 'owner', fieldId: numericId, alias: 'owner_exact' },
          { source: 'owner', fieldId: bigintId, alias: 'owner_big' },
          { source: 'owner', fieldId: integerId, alias: 'owner_small' },
          { source: 'owner', system: 'autoNumber', alias: 'owner_sequence' },
          { source: 'owner', fieldId: amountId, alias: 'owner_amount' },
          { source: 'owner', fieldId: amountId, alias: 'owner_amount_copy' },
        ];
        const canonicalRelated = await relation(relatedSelect, { sort });
        expect(canonicalRelated.rows.map(({ owner_flag }) => owner_flag)).toEqual([
          true,
          false,
          null,
          true,
        ]);
        expect(canonicalRelated.rows[0]).toMatchObject({
          owner_exact: '9007199254740993.00',
          owner_big: '9223372036854775807',
          owner_small: 2147483647,
          owner_sequence: 1,
          amount: '1.00',
          amount_copy: '1.00',
          owner_amount: 1,
          owner_amount_copy: 1,
        });
        const related = await relation(relatedSelect, {
          ...extra,
          page: { ...extra.page, limit: 100 },
        });
        expect(related.rows).toEqual(canonicalRelated.rows);
        expect(related.page?.total).toBe(canonicalRelated.rows.length);
        for (const [source, includeOwner] of [
          ['root', false],
          ['root', true],
          ['owner', true],
        ] as const) {
          for (const alias of ['flag', 'amount', 'exact']) {
            for (const order of ['asc', 'desc']) {
              for (const nulls of ['first', 'last']) {
                const selected = includeOwner ? relatedSelect : select;
                const fieldId =
                  alias === 'flag' ? checkboxId : alias === 'amount' ? amountId : numericId;
                const aliasSort = {
                  alias: source === 'root' ? alias : `owner_${alias}`,
                  order,
                  nulls,
                };
                const options = {
                  sort: [
                    nulls === 'first'
                      ? aliasSort
                      : { ...(source === 'owner' ? { source } : {}), fieldId, order, nulls },
                  ],
                  ...(includeOwner
                    ? { relations: { owner: { linkFieldId: ownerId, tableId: targetId } } }
                    : {}),
                };
                // DISTINCT sorts finalized numeric strings; ordinary pages sort
                // native numbers. Verify order and canonical values independently.
                const baselineOptions = { ...options, distinct: undefined };
                const baseline = includeOwner
                  ? await relation(selected, baselineOptions)
                  : await run(selected, baselineOptions);
                const paginated = definition(selected, { ...extra, ...options });
                const prepared = includeOwner
                  ? DataQueryRelationBinding.prepare(paginated, root, new Map([['owner', target]]))
                  : undefined;
                if (prepared?.isErr())
                  throw new Error(
                    `precision ${precision} ${source}/${alias}/${order}/${nulls} relation preparation: ${JSON.stringify(prepared.error)}`
                  );
                const binding = prepared?.value;
                const rows: Record<string, unknown>[] = [];
                let after: string | undefined;
                for (let index = 0; index < baseline.rows.length; index++) {
                  const bound = paginated.bind(after ? { cursor: after } : {});
                  if (bound.isErr())
                    throw new Error(
                      `precision ${precision} ${source}/${alias}/${order}/${nulls} page ${index} binding: ${JSON.stringify(bound.error)}`
                    );
                  const query = bound.value;
                  const result = binding
                    ? await executor.executeRelation(context, {
                        query,
                        rootTable: root,
                        rootScope: {},
                        plan: binding.plan,
                        sources: [
                          { alias: 'owner', table: target, linkFieldId: ownerId, scope: {} },
                        ],
                      })
                    : await executor.execute(context, root, query, {});
                  if (result.isErr())
                    throw new Error(
                      `${source}/${alias}/${order}/${nulls} page ${index}: ${JSON.stringify(result.error)}`
                    );
                  const page = result.value;
                  rows.push(...page.rows);
                  expect(page.page?.total).toBe(baseline.rows.length);
                  after =
                    page.page && 'nextCursor' in page.page
                      ? (page.page.nextCursor ?? undefined)
                      : undefined;
                  expect(after).toEqual(
                    index === baseline.rows.length - 1 ? undefined : expect.any(String)
                  );
                }
                const canonicalRows = includeOwner ? canonicalRelated.rows : canonical.rows;
                expect(rows, `${source}/${includeOwner}/${alias}/${order}/${nulls}`).toEqual(
                  baseline.rows.map(({ id }) => canonicalRows.find((row) => row.id === id))
                );
              }
            }
          }
        }
      } finally {
        await sql`select set_config('extra_float_digits', ${previous.rows[0].value}, false)`.execute(
          database.db
        );
      }
    }
  );

  it('preserves bigint-native values behind persisted REAL metadata', async () => {
    await sql`alter table distinct_root alter column amount type bigint using amount::bigint`.execute(
      database.db
    );
    await sql`insert into distinct_root (__id,amount) values
      ('a',9007199254740993),('b',9007199254740992),('c',9223372036854775807),('d',null)`.execute(
      database.db
    );
    for (const direction of ['asc', 'desc'] as const) {
      const input = definition(
        [
          { system: 'id', alias: 'id' },
          { fieldId: amountId, alias: 'amount' },
        ],
        {
          version: 7,
          distinct: undefined,
          sort: [{ fieldId: amountId, order: direction, nulls: 'last' }],
          parameters: { cursor: { type: 'string' } },
          page: { limit: 1, after: { type: 'parameter', name: 'cursor' } },
        }
      );
      const seen: unknown[] = [];
      const values: unknown[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 4; page++) {
        const result = (
          await executor.execute(
            context,
            root,
            input.bind(cursor ? { cursor } : {})._unsafeUnwrap(),
            {}
          )
        )._unsafeUnwrap();
        seen.push(result.rows[0].id);
        values.push(result.rows[0].amount);
        cursor =
          result.page && 'nextCursor' in result.page
            ? (result.page.nextCursor ?? undefined)
            : undefined;
      }
      expect(seen).toEqual(direction === 'asc' ? ['b', 'a', 'c', 'd'] : ['c', 'a', 'b', 'd']);
      expect(values).toEqual(
        direction === 'asc'
          ? ['9007199254740992', '9007199254740993', '9223372036854775807', null]
          : ['9223372036854775807', '9007199254740993', '9007199254740992', null]
      );
      expect(cursor).toBeUndefined();
    }
  });

  it('continues pages after long scalar sort keys without truncating the position', async () => {
    const prefix = 'long-sort-value'.repeat(4096);
    await sql`insert into distinct_root (__id,title) values ('a',${`${prefix}a`}),('b',${`${prefix}b`})`.execute(
      database.db
    );
    const input = definition([{ fieldId: titleId, alias: 'title' }], {
      version: 7,
      sort: [{ alias: 'title', order: 'asc' }],
      parameters: { cursor: { type: 'string' } },
      page: { limit: 1, after: { type: 'parameter', name: 'cursor' } },
    });
    const first = (
      await executor.execute(context, root, input.bind({})._unsafeUnwrap(), {})
    )._unsafeUnwrap();
    expect(first.rows).toEqual([{ title: `${prefix}a` }]);
    if (!first.page || !('nextCursor' in first.page) || !first.page.nextCursor)
      throw new Error('Expected a continuation for the remaining long sort value');
    const last = (
      await executor.execute(
        context,
        root,
        input.bind({ cursor: first.page.nextCursor })._unsafeUnwrap(),
        {}
      )
    )._unsafeUnwrap();
    expect(last).toEqual({ rows: [{ title: `${prefix}b` }], page: { limit: 1, nextCursor: null } });
  });

  it.each([
    { source: 'root', nulls: 'first' },
    { source: 'root', nulls: 'last' },
    { source: 'owner', nulls: 'first' },
    { source: 'owner', nulls: 'last' },
  ] as const)(
    'preserves native numeric array field sorting for $source cursor pages with nulls $nulls',
    async ({ source, nulls }) => {
      const lookupId = `fld${'h'.repeat(16)}`;
      const lookupField = {
        id: lookupId,
        name: 'Numbers',
        type: 'number' as const,
        dbFieldName: 'numbers',
        isLookup: true,
        lookupOptions: { linkFieldId: itemsId, foreignTableId: targetId, lookupFieldId: amountId },
        options: { formatting: { type: 'decimal' as const, precision: 0 } },
        cellValueType: 'number' as const,
        isMultipleCellValue: true,
      };
      const mappedRoot = mapper.toDomain({
        ...rootDto(),
        fields: [...rootDto().fields, lookupField],
      });
      if (mappedRoot.isErr()) throw new Error(`root fixture: ${JSON.stringify(mappedRoot.error)}`);
      root = mappedRoot.value;
      const mappedTarget = mapper.toDomain({
        ...targetDto(),
        fields: [...rootDto().fields, lookupField],
      });
      if (mappedTarget.isErr())
        throw new Error(`target fixture: ${JSON.stringify(mappedTarget.error)}`);
      target = mappedTarget.value;
      for (const table of [root, target]) {
        const lookup = table
          .getField((field) => field.id().toString() === lookupId)
          ._unsafeUnwrap();
        if (!(lookup instanceof LookupField)) throw new Error('Expected a numeric lookup');
        const validated = lookup.validateForeignTables({
          hostTable: table,
          foreignTables: [root, target],
        });
        if (validated.isErr())
          throw new Error(`lookup fixture: ${JSON.stringify(validated.error)}`);
      }
      await sql`alter table distinct_root add column numbers jsonb`.execute(database.db);
      await sql`alter table distinct_target add column numbers jsonb`.execute(database.db);
      await sql`insert into distinct_root (__id,title,fk_owner,numbers) values
        ('a','first','owner-a','[1,3]'::jsonb),
        ('b','second','owner-b','[2]'::jsonb),
        ('c','third','owner-c','[1,null]'::jsonb),
        ('d','fourth','owner-d','[1,null]'::jsonb),
        ('e','fifth','owner-e',null)`.execute(database.db);
      await sql`insert into distinct_target (__id,title,numbers) values
        ('owner-a','first','[1,3]'::jsonb),
        ('owner-b','second','[2]'::jsonb),
        ('owner-c','third','[1,null]'::jsonb),
        ('owner-d','fourth','[1,null]'::jsonb),
        ('owner-e','fifth',null)`.execute(database.db);
      for (const order of ['asc', 'desc'] as const) {
        const select = [{ system: 'id', alias: 'id' }];
        const sort = [
          { ...(source === 'owner' ? { source } : {}), fieldId: lookupId, order, nulls },
        ];
        const extra = {
          distinct: undefined,
          sort,
          ...(source === 'owner'
            ? {
                relations: { owner: { linkFieldId: ownerId, tableId: targetId } },
              }
            : {}),
        };
        const offset = source === 'root' ? await run(select, extra) : await relation(select, extra);
        const finiteIds = order === 'asc' ? ['a', 'c', 'd', 'b'] : ['b', 'c', 'd', 'a'];
        const expected = (nulls === 'first' ? ['e', ...finiteIds] : [...finiteIds, 'e']).map(
          (id) => ({ id })
        );
        expect(offset.rows).toEqual(expected);
        const input = definition(select, {
          ...extra,
          version: 7,
          parameters: { cursor: { type: 'string' } },
          page: { limit: 1, after: { type: 'parameter', name: 'cursor' } },
        });
        let cursor: string | undefined;
        const seen: unknown[] = [];
        for (let index = 0; index < expected.length; index++) {
          const query = input.bind(cursor ? { cursor } : {})._unsafeUnwrap();
          const result =
            source === 'root'
              ? await executor.execute(context, root, query, {})
              : await executor.executeRelation(context, {
                  query,
                  rootTable: root,
                  rootScope: {},
                  plan: DataQueryRelationBinding.prepare(
                    input,
                    root,
                    new Map([['owner', target]])
                  )._unsafeUnwrap().plan,
                  sources: [{ alias: 'owner', table: target, linkFieldId: ownerId, scope: {} }],
                });
          if (result.isErr())
            throw new Error(`array page ${index}: ${JSON.stringify(result.error)}`);
          const page = result._unsafeUnwrap();
          seen.push(...page.rows);
          cursor =
            page.page && 'nextCursor' in page.page
              ? (page.page.nextCursor ?? undefined)
              : undefined;
          expect(cursor).toEqual(index === expected.length - 1 ? undefined : expect.any(String));
        }
        expect(seen).toEqual(expected);
      }
    }
  );

  it('binds continuations to masks and returns masked finalized DISTINCT totals before keyset', async () => {
    await sql`insert into distinct_root (__id,title,floating) values ('a','hidden A',1),('b','visible',2),('c','hidden C',3)`.execute(
      database.db
    );
    const visibleWhen = buildRecordConditionSpec(root, {
      fieldId: titleId,
      operator: 'is',
      value: 'visible',
    })._unsafeUnwrap();
    const scope = { fieldMasks: [{ fieldId: titleId, visibleWhen }] };
    const input = definition([{ fieldId: titleId, alias: 'title' }], {
      version: 7,
      parameters: { cursor: { type: 'string' } },
      page: { limit: 1, after: { type: 'parameter', name: 'cursor' }, includeTotal: true },
    });
    const first = (
      await executor.execute(context, root, input.bind({})._unsafeUnwrap(), scope)
    )._unsafeUnwrap();
    expect(first.rows).toEqual([{ title: null }]);
    expect(first.page?.total).toBe(2);
    const cursor = first.page && 'nextCursor' in first.page ? first.page.nextCursor! : '';
    const next = input.bind({ cursor })._unsafeUnwrap();
    expect((await executor.execute(context, root, next, {})).isErr()).toBe(true);
    const last = (await executor.execute(context, root, next, scope))._unsafeUnwrap();
    expect(last).toEqual({
      rows: [{ title: 'visible' }],
      page: { limit: 1, total: 2, nextCursor: null },
    });
    expect(
      (
        await executor.execute(
          context,
          root,
          input.bind({ cursor: `${cursor}x` })._unsafeUnwrap(),
          scope
        )
      ).isErr()
    ).toBe(true);
  });

  it('rejects a continuation after a used live field changes formatting options', async () => {
    await sql`insert into distinct_root (__id,amount) values ('a',1),('b',2)`.execute(database.db);
    const input = definition([{ fieldId: amountId, alias: 'amount' }], {
      version: 7,
      parameters: { cursor: { type: 'string' } },
      page: { limit: 1, after: { type: 'parameter', name: 'cursor' } },
    });
    const first = (
      await executor.execute(context, root, input.bind({})._unsafeUnwrap(), {})
    )._unsafeUnwrap();
    const cursor = first.page && 'nextCursor' in first.page ? first.page.nextCursor : null;
    expect(cursor).toEqual(expect.any(String));
    const next = input.bind({ cursor })._unsafeUnwrap();
    expect((await executor.execute(context, root, next, {}))._unsafeUnwrap().rows).toEqual([
      { amount: '2' },
    ]);
    const dto = rootDto();
    const changed = mapper
      .toDomain({
        ...dto,
        fields: dto.fields.map((field) =>
          field.id === amountId
            ? { ...field, options: { formatting: { type: 'decimal', precision: 5 } } }
            : field
        ),
      })
      ._unsafeUnwrap();
    expect((await executor.execute(context, changed, next, {}))._unsafeUnwrapErr()).toMatchObject({
      code: 'data_query.invalid_cursor',
    });
  });

  it('rejects a continuation reused by a definition with a different sort', async () => {
    await sql`insert into distinct_root (__id,title) values ('a','A'),('b','B')`.execute(
      database.db
    );
    const input = definition([{ fieldId: titleId, alias: 'title' }], {
      version: 7,
      parameters: { cursor: { type: 'string' } },
      sort: [{ alias: 'title', order: 'asc' }],
      page: { limit: 1, after: { type: 'parameter', name: 'cursor' } },
    });
    const first = (
      await executor.execute(context, root, input.bind({})._unsafeUnwrap(), {})
    )._unsafeUnwrap();
    const cursor = first.page && 'nextCursor' in first.page ? first.page.nextCursor : null;
    expect(cursor).toEqual(expect.any(String));
    const changed = DataQueryDefinition.create({
      ...input.snapshot(),
      sort: [{ alias: 'title', order: 'desc' }],
    })._unsafeUnwrap();
    expect(
      (
        await executor.execute(context, root, changed.bind({ cursor })._unsafeUnwrap(), {})
      )._unsafeUnwrapErr()
    ).toMatchObject({
      code: 'data_query.invalid_cursor',
    });
  });

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
    await sql`alter table distinct_root alter column __auto_number type bigint,
      alter column __auto_number drop not null`.execute(database.db);
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
