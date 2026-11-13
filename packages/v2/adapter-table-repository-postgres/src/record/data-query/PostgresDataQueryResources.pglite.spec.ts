import {
  ActorId,
  DefaultTableMapper,
  NoopLogger,
  RecordQueryPluginRunner,
  type ITablePersistenceDTO,
} from '@teable/v2-core';
import { DataQueryDefinition, DataQueryService } from '@teable/v2-data-query';
import { FormulaSqlPgTranslator, Pg16TypeValidationStrategy } from '@teable/v2-formula-sql-pg';
import { sql } from 'kysely';
import { ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createPGliteDb,
  type PGliteTestDb,
} from '../../schema/visitors/__tests__/helpers/createPGliteDb';
import { dataQueryExecutionError } from './dataQueryExecutionError';
import { PostgresDataQueryExecutor } from './PostgresDataQueryExecutor';

const tableId = `tbl${'r'.repeat(16)}`;
const titleId = `fld${'t'.repeat(16)}`;
const countId = `fld${'c'.repeat(16)}`;
const context = { actorId: ActorId.create('resource-reader')._unsafeUnwrap() };
const tableDto: ITablePersistenceDTO = {
  id: tableId,
  baseId: `bse${'r'.repeat(16)}`,
  name: 'Resource inputs',
  dbTableName: 'public.resource_inputs',
  primaryFieldId: titleId,
  fields: [
    { id: titleId, name: 'Title', type: 'singleLineText', dbFieldName: 'title' },
    {
      id: countId,
      name: 'Count',
      type: 'number',
      dbFieldName: 'count',
      options: { formatting: { type: 'decimal', precision: 0 } },
    },
  ],
  views: [{ id: `viw${'r'.repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
};

const definition = (formula: string) =>
  DataQueryDefinition.create({
    version: 3,
    tableId,
    kind: 'records',
    select: [
      {
        alias: 'result',
        expr: {
          type: 'formula',
          formula,
          references: {
            title: { type: 'field', fieldId: titleId },
            count: { type: 'field', fieldId: countId },
          },
        },
      },
    ],
  })._unsafeUnwrap();

// Baseline expansions never exceed about 1 MiB: no timeout/OOM repro is needed.
// The public service executes the canonical translator's SQL in PostgreSQL.
describe('query formula repetition resource limits', () => {
  let database: PGliteTestDb;
  let service: DataQueryService;

  beforeEach(async () => {
    database = await createPGliteDb();
    const table = new DefaultTableMapper().toDomain(tableDto)._unsafeUnwrap();
    service = new DataQueryService(
      { findOne: async () => ok(table) },
      new RecordQueryPluginRunner([], new NoopLogger()),
      new PostgresDataQueryExecutor(database.db)
    );
    await sql`create table resource_inputs (
      __id text primary key, title text, count double precision,
      __created_time timestamptz default now(), __last_modified_time timestamptz,
      __auto_number bigint, __version integer default 1
    )`.execute(database.db);
    await sql`insert into resource_inputs (__id, title, count) values ('recInput', 'a', 1048577)`.execute(
      database.db
    );
  });

  afterEach(async () => {
    await database.db.destroy();
  });

  it.each(['metric', 'filter', 'having'] as const)(
    'v4 maps %s repetition limits to query-only errors',
    async (stage) => {
      const expression = {
        type: 'formula',
        formula: 'LEN(REPT({title}, {count}))',
        references: {
          title: { type: 'field', fieldId: titleId },
          count: { type: 'field', fieldId: countId },
        },
      } as const;
      const parsed = DataQueryDefinition.create({
        version: 4,
        tableId,
        kind: 'aggregate',
        aggregates:
          stage === 'metric'
            ? [{ expr: expression, statisticFunc: 'sum', alias: 'value' }]
            : [
                {
                  fieldId: countId,
                  statisticFunc: 'sum',
                  alias: 'value',
                  ...(stage === 'filter'
                    ? {
                        filter: { ...expression, formula: `${expression.formula} > 0` },
                      }
                    : {}),
                },
              ],
        ...(stage === 'having'
          ? {
              having: {
                type: 'formula',
                formula: 'LEN(REPT("a", {value})) > 0',
                references: {
                  value: { type: 'output', alias: 'value' },
                },
              },
            }
          : {}),
      });
      if (parsed.isErr()) throw new Error(JSON.stringify(parsed.error));
      const result = await service.execute(context, parsed.value);
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toMatchObject({
        code: 'data_query.expression_resource_limit',
      });
      expect(JSON.stringify(result._unsafeUnwrapErr())).not.toMatch(/resource_inputs|1048577/i);
    }
  );

  it('v4 excludes a metric input before evaluating its oversized formula', async () => {
    const parsed = DataQueryDefinition.create({
      version: 4,
      tableId,
      kind: 'aggregate',
      aggregates: [
        {
          expr: {
            type: 'formula',
            formula: 'LEN(REPT({title}, {count}))',
            references: {
              title: { type: 'field', fieldId: titleId },
              count: { type: 'field', fieldId: countId },
            },
          },
          statisticFunc: 'sum',
          alias: 'value',
          filter: {
            fieldId: countId,
            operator: 'isLess',
            value: 0,
          },
        },
      ],
    });
    if (parsed.isErr()) throw new Error(JSON.stringify(parsed.error));
    const result = await service.execute(context, parsed.value);
    if (result.isErr()) throw new Error(JSON.stringify(result.error));
    expect(result.value.rows).toEqual([{ value: null }]);
  });

  it.each([
    ['dynamic count and text', 'LEN(REPT({title}, {count}))'],
    ['nested expansion', 'LEN(REPT(REPT("a", 1025), 1025))'],
    ['discarded oversized intermediate', 'LEN(LEFT(REPT({title}, {count}), 1))'],
  ])('rejects %s before allocating an oversized intermediate', async (_name, formula) => {
    const result = await service.execute(context, definition(formula));
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: 'data_query.expression_resource_limit',
    });
    expect(JSON.stringify(result._unsafeUnwrapErr())).not.toMatch(
      /repeat|resource_inputs|1048577/i
    );
    expect((await sql`select 1 as alive`.execute(database.db)).rows).toEqual([{ alive: 1 }]);
  });

  it('limits UTF-8 bytes rather than characters', async () => {
    await sql`update resource_inputs set title = '界', count = 349526`.execute(database.db);
    const result = await service.execute(context, definition('LEN(REPT({title}, {count}))'));
    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: 'data_query.expression_resource_limit',
    });
  });

  it.each([
    ['at byte limit', 'LEN(REPT({title}, 1048576))', 1048576],
    ['negative', 'REPT({title}, -1)', ''],
    ['zero', 'REPT({title}, 0)', ''],
    ['empty input', 'REPT("", {count})', ''],
    ['fractional count', 'REPT({title}, 2.4)', 'aa'],
    ['ordinary nested', 'REPT(REPT({title}, 2), 3)', 'aaaaaa'],
    ['lazy unused branch', 'IF({count} > 0, "safe", REPT({title}, {count}))', 'safe'],
    ['lazy constant branch', 'IF(1, "safe", REPT("a", 1048577))', 'safe'],
  ])('preserves %s behavior', async (_name, formula, expected) => {
    expect((await service.execute(context, definition(formula)))._unsafeUnwrap().rows).toEqual([
      { result: expected },
    ]);
  });

  it('preserves ordinary multibyte repetition', async () => {
    await sql`update resource_inputs set title = '界🙂', count = 2`.execute(database.db);
    expect(
      (await service.execute(context, definition('REPT({title}, {count})')))._unsafeUnwrap().rows
    ).toEqual([{ result: '界🙂界🙂' }]);
  });

  it('leaves stored formula translation outside the query byte cap', async () => {
    const translator = new FormulaSqlPgTranslator({
      references: new Map(),
      tableAlias: 'stored',
      typeValidationStrategy: new Pg16TypeValidationStrategy(),
    });
    const expression = translator.translateExpression('LEN(REPT("a", 1048577))')._unsafeUnwrap();
    const rendered = translator
      .renderExpression(expression, (value) => value.valueSql)
      ._unsafeUnwrap();
    expect((await sql`select ${sql.raw(rendered)} as result`.execute(database.db)).rows).toEqual([
      { result: 1048577 },
    ]);
  });

  it('classifies native program-limit rejection only for expression queries', async () => {
    // PostgreSQL checks 2 * INT_MAX before allocating any repeated text.
    const error = await sql`select repeat('xx', 2147483647)`.execute(database.db).then(
      () => undefined,
      (failure: unknown) => failure
    );
    expect(error).toMatchObject({ code: '54000' });
    expect(dataQueryExecutionError(error, true)).toMatchObject({
      code: 'data_query.expression_resource_limit',
    });
    expect(dataQueryExecutionError(error, false)).toMatchObject({
      code: 'data_query.execution_failed',
      details: { sqlState: '54000' },
    });
  });

  it.each(['57014', '53200', '08006', 'XX000'])(
    'does not turn infrastructure SQLSTATE %s into a resource validation error',
    (code) => {
      expect(dataQueryExecutionError({ code }, true)).toMatchObject({
        code: code === '57014' ? 'data_query.timeout' : 'data_query.execution_failed',
        details: { sqlState: code },
      });
    }
  );
});
