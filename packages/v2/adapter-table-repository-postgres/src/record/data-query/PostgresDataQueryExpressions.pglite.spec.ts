import {
  ActorId,
  buildRecordConditionSpec,
  DefaultTableMapper,
  NoopLogger,
  LookupField,
  RecordQueryPluginRunner,
  type ITablePersistenceDTO,
  type IRecordQueryPlugin,
  type RecordQueryPluginScope,
} from '@teable/v2-core';
import {
  DataQueryBinding,
  DataQueryDefinition,
  DataQueryExplainService,
  DataQueryService,
  type DataQueryFormulaReference,
  type DataQueryFormulaExpression,
} from '@teable/v2-data-query';
import {
  createFormulaCompileBudgetPolicy,
  defaultFormulaCompileBudgetLimits,
} from '@teable/v2-formula-sql-pg';
import { sql } from 'kysely';
import { ok, type Result } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createPGliteDb,
  type PGliteTestDb,
} from '../../schema/visitors/__tests__/helpers/createPGliteDb';
import { PostgresDataQueryExecutor } from './PostgresDataQueryExecutor';
import { PostgresDataQueryExplainer } from './PostgresDataQueryExplainer';

const tableId = `tbl${'e'.repeat(16)}`;
const titleId = `fld${'t'.repeat(16)}`;
const quantityId = `fld${'q'.repeat(16)}`;
const tagsId = `fld${'z'.repeat(16)}`;
const priceId = `fld${'p'.repeat(16)}`;
const discountId = `fld${'d'.repeat(16)}`;
const occurredAtId = `fld${'o'.repeat(16)}`;
const emailId = `fld${'m'.repeat(16)}`;
const paidId = `fld${'b'.repeat(16)}`;
const context = { actorId: ActorId.create('expression-reader')._unsafeUnwrap() };
const physicalTable = 'Expression "orders';
const onlyAlpha = {
  type: 'formula',
  formula: '{id} = "recA"',
  references: { id: { type: 'system', system: 'id' } },
} as const;

const tableDto: ITablePersistenceDTO = {
  id: tableId,
  baseId: `bse${'e'.repeat(16)}`,
  name: 'Expression orders',
  dbTableName: `public.${physicalTable}`,
  primaryFieldId: titleId,
  fields: [
    { id: titleId, name: 'Title', type: 'singleLineText', dbFieldName: 'title' },
    { id: occurredAtId, name: 'Due at', type: 'date', dbFieldName: 'due_at' },
    { id: emailId, name: 'Email', type: 'singleLineText', dbFieldName: 'email' },
    { id: paidId, name: 'Paid', type: 'checkbox', dbFieldName: 'paid' },
    {
      id: tagsId,
      name: 'Tags',
      type: 'multipleSelect',
      dbFieldName: 'tags',
      options: {
        choices: [
          { id: 'tagX', name: 'X', color: 'blue' },
          { id: 'tagY', name: 'Y', color: 'green' },
        ],
      },
    },
    ...[
      { id: quantityId, name: 'Quantity', column: 'quantity' },
      { id: priceId, name: 'Unit price', column: 'unit_price' },
      { id: discountId, name: 'Discount', column: 'discount' },
    ].map(({ id, name, column }) => ({
      id,
      name,
      type: 'number' as const,
      dbFieldName: column,
      options: { formatting: { type: 'decimal' as const, precision: 2 } },
    })),
  ],
  views: [{ id: `viw${'e'.repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
};

const reference = (fieldId: string, source?: string): DataQueryFormulaReference => ({
  type: 'field',
  fieldId,
  ...(source === undefined ? {} : { source }),
});
const parameterReference = (name: string): DataQueryFormulaReference => ({
  type: 'parameter',
  name,
});
const parseText = 'DATETIME_FORMAT(DATETIME_PARSE({title}), "YYYY-MM-DD HH:mm:ss")';
const parseDateText =
  'DATETIME_FORMAT(DATETIME_PARSE({title}, "YYYY-MM-DD"), "YYYY-MM-DD HH:mm:ss")';
const formula = (
  text: string,
  references: Record<string, DataQueryFormulaReference> = {},
  timeZone?: string
): DataQueryFormulaExpression => ({
  type: 'formula',
  formula: text,
  references,
  ...(timeZone === undefined ? {} : { timeZone }),
});
const netAmount: DataQueryFormulaExpression = formula(
  '{quantity} * {price} - IF({discount}, {discount}, 0)',
  {
    quantity: reference(quantityId),
    price: reference(priceId),
    discount: reference(discountId),
  }
);
const field = (fieldId: string, source?: string): DataQueryFormulaExpression =>
  formula('{value}', { value: reference(fieldId, source) });
const records = (
  expressions: Record<string, DataQueryFormulaExpression>,
  extra: Record<string, unknown> = {}
) =>
  DataQueryDefinition.create({
    version: 3,
    tableId,
    kind: 'records',
    select: [
      { system: 'id', alias: 'id' },
      ...Object.entries(expressions).map(([alias, expr]) => ({ expr, alias })),
    ],
    ...extra,
  })._unsafeUnwrap();

// These cases use the same public service seam as the HTTP executor, with real SQL.
describe('scalar expressions through the native query service', () => {
  let database: PGliteTestDb;
  let service: DataQueryService;
  const scopedService = (scope: RecordQueryPluginScope) => {
    const table = new DefaultTableMapper().toDomain(tableDto)._unsafeUnwrap();
    const plugin: IRecordQueryPlugin = {
      name: 'expression-access',
      supports: () => true,
      scope: () => ok(scope),
    };
    return new DataQueryService(
      { findOne: async () => ok(table) },
      new RecordQueryPluginRunner([plugin], new NoopLogger()),
      new PostgresDataQueryExecutor(database.db)
    );
  };

  beforeEach(async () => {
    database = await createPGliteDb();
    const table = new DefaultTableMapper().toDomain(tableDto)._unsafeUnwrap();
    service = new DataQueryService(
      { findOne: async () => ok(table) },
      new RecordQueryPluginRunner([], new NoopLogger()),
      new PostgresDataQueryExecutor(database.db)
    );
    await sql`create table ${sql.id('public', physicalTable)} (
      __id text primary key, title text, quantity double precision,
      unit_price double precision, discount double precision,
      due_at timestamptz default '2026-03-07T17:00:00Z', email text, paid boolean,
      tags jsonb,
      __created_time timestamptz default '2026-01-01T00:00:00Z',
      __last_modified_time timestamptz, __auto_number bigint,
      __version integer default 1
    )`.execute(database.db);
    for (const [id, title, quantity, price, discount, order, email, paid] of [
      ['recA', 'ALPHA', 2, 10, 5, 1, 'ALPHA@EXAMPLE.COM', true],
      ['recB', 'GAMMA', 3, 4, null, 2, null, false],
      ['recC', 'Beta', 5, 6, 3, 3, 'BETA@EXAMPLE.COM', null],
    ]) {
      await sql`insert into ${sql.id('public', physicalTable)}
        (__id, title, quantity, unit_price, discount, __auto_number, email, paid)
        values (${id}, ${title}, ${quantity}, ${price}, ${discount}, ${order}, ${email}, ${paid})`.execute(
        database.db
      );
    }
  });

  afterEach(async () => {
    await database.db.destroy();
  });

  const resultValue = <T>(result: Result<T, unknown>): T => {
    if (result.isErr()) throw new Error(`v4 query: ${JSON.stringify(result.error)}`);
    return result.value;
  };

  it('v4 aggregates row formulas and independent conditional counts before HAVING and paging', async () => {
    const definition = resultValue(
      DataQueryDefinition.create({
        version: 4,
        tableId,
        kind: 'aggregate',
        parameters: { minimum: { type: 'number' } },
        aggregates: [
          { expr: netAmount, statisticFunc: 'sum', alias: 'revenue' },
          {
            fieldId: quantityId,
            statisticFunc: 'count',
            alias: 'paidRows',
            filter: formula('{paid}', { paid: reference(paidId) }),
          },
          { expr: field(quantityId), statisticFunc: 'count', alias: 'allRows' },
        ],
        having: {
          type: 'formula',
          formula: '{revenue} >= {minimum}',
          references: {
            revenue: { type: 'output', alias: 'revenue' },
            minimum: parameterReference('minimum'),
          },
        },
        page: { limit: 1, offset: 0, includeTotal: true },
      })
    );
    expect(
      resultValue(await service.execute(context, definition, { parameters: { minimum: 50 } }))
    ).toEqual({
      rows: [{ revenue: 54, paidRows: 1, allRows: 3 }],
      page: { limit: 1, offset: 0, total: 1 },
    });
    expect(
      resultValue(await service.execute(context, definition, { parameters: { minimum: 55 } }))
    ).toEqual({
      rows: [],
      page: { limit: 1, offset: 0, total: 0 },
    });
    const offset = resultValue(
      DataQueryDefinition.create({
        ...definition.snapshot(),
        page: { limit: 1, offset: 2, includeTotal: true },
      })
    );
    expect(
      resultValue(await service.execute(context, offset, { parameters: { minimum: 50 } }))
    ).toEqual({
      rows: [],
      page: { limit: 1, offset: 2, total: 1 },
    });
  });

  it('v4 filters multiple-select unique metrics before flattening', async () => {
    await sql`update ${sql.id('public', physicalTable)}
      set tags = ${JSON.stringify(['X', 'Y'])}::jsonb where __id = 'recA'`.execute(database.db);
    await sql`update ${sql.id('public', physicalTable)}
      set tags = ${JSON.stringify(['Y'])}::jsonb where __id = 'recB'`.execute(database.db);
    await sql`update ${sql.id('public', physicalTable)}
      set tags = '[]'::jsonb where __id = 'recC'`.execute(database.db);

    const aggregate = (filter?: DataQueryFormulaExpression) =>
      resultValue(
        DataQueryDefinition.create({
          version: 4,
          tableId,
          kind: 'aggregate',
          aggregates: [
            {
              fieldId: tagsId,
              statisticFunc: 'unique',
              alias: 'unique',
              ...(filter === undefined ? {} : { filter }),
            },
            {
              fieldId: tagsId,
              statisticFunc: 'percentUnique',
              alias: 'percentUnique',
              ...(filter === undefined ? {} : { filter }),
            },
          ],
        })
      );

    expect(resultValue(await service.execute(context, aggregate()))).toEqual({
      rows: [{ unique: 2, percentUnique: 200 / 3 }],
    });
    expect(resultValue(await service.execute(context, aggregate(onlyAlpha)))).toEqual({
      rows: [{ unique: 2, percentUnique: 100 }],
    });
    expect(
      resultValue(await service.execute(context, aggregate(formula('RECORD_ID() = "missing"'))))
    ).toEqual({ rows: [{ unique: 0, percentUnique: 0 }] });
  });

  it('v4 filters scalar percentUnique numerator and denominator together', async () => {
    const aggregate = (filter?: DataQueryFormulaExpression) =>
      resultValue(
        DataQueryDefinition.create({
          version: 4,
          tableId,
          kind: 'aggregate',
          aggregates: [
            {
              fieldId: emailId,
              statisticFunc: 'percentUnique',
              alias: 'percentUnique',
              ...(filter === undefined ? {} : { filter }),
            },
          ],
        })
      );

    expect(resultValue(await service.execute(context, aggregate(onlyAlpha)))).toEqual({
      rows: [{ percentUnique: 100 }],
    });
    expect(
      resultValue(await service.execute(context, aggregate(formula('RECORD_ID() = "missing"'))))
    ).toEqual({ rows: [{ percentUnique: 0 }] });
  });

  it('v4 returns zero percentages for groups with no metric-filter matches', async () => {
    const aggregates = [
      { fieldId: quantityId, statisticFunc: 'percentFilled', alias: 'filled' },
      { fieldId: quantityId, statisticFunc: 'percentEmpty', alias: 'empty' },
      { fieldId: quantityId, statisticFunc: 'percentUnique', alias: 'unique' },
      { fieldId: paidId, statisticFunc: 'percentChecked', alias: 'checked' },
      { fieldId: paidId, statisticFunc: 'percentUnChecked', alias: 'unchecked' },
    ];
    const grouped = resultValue(
      DataQueryDefinition.create({
        version: 4,
        kind: 'aggregate',
        tableId,
        groupBy: [{ fieldId: titleId, alias: 'title' }],
        aggregates: aggregates.map((metric) => ({ ...metric, filter: onlyAlpha })),
      })
    );
    expect(resultValue(await service.execute(context, grouped))).toEqual({
      rows: [
        { title: 'ALPHA', filled: 100, empty: 0, unique: 100, checked: 100, unchecked: 0 },
        { title: 'Beta', filled: 0, empty: 0, unique: 0, checked: 0, unchecked: 0 },
        { title: 'GAMMA', filled: 0, empty: 0, unique: 0, checked: 0, unchecked: 0 },
      ],
    });

    // An empty global scope without metric predicates retains the legacy SQL NULLs.
    const unfilteredEmpty = resultValue(
      DataQueryDefinition.create({
        version: 4,
        kind: 'aggregate',
        tableId,
        filter: formula('RECORD_ID() = "missing"'),
        aggregates,
      })
    );
    expect(resultValue(await service.execute(context, unfilteredEmpty))).toEqual({
      rows: [{ filled: 0, empty: 0, unique: 0, checked: null, unchecked: null }],
    });
  });

  it('v4 masks metric inputs and rejects denied references even when declared but unused', async () => {
    const definition = resultValue(
      DataQueryDefinition.create({
        version: 4,
        tableId,
        kind: 'aggregate',
        aggregates: [
          {
            expr: formula('IF({price}, {quantity} * {price}, 0)', {
              quantity: reference(quantityId),
              price: reference(priceId),
            }),
            statisticFunc: 'sum',
            alias: 'revenue',
          },
        ],
        page: { limit: 10, includeTotal: true },
      })
    );
    const visible = buildRecordConditionSpec(
      new DefaultTableMapper().toDomain(tableDto)._unsafeUnwrap(),
      {
        fieldId: titleId,
        operator: 'is',
        value: 'ALPHA',
      }
    )._unsafeUnwrap();
    const masked = scopedService({ fieldMasks: [{ fieldId: priceId, visibleWhen: visible }] });
    expect(resultValue(await masked.execute(context, definition)).rows).toEqual([{ revenue: 20 }]);
    const denied = scopedService({ readableFieldIds: new Set([titleId, quantityId]) });
    expect((await denied.execute(context, definition)).isErr()).toBe(true);
    const unused = resultValue(
      DataQueryDefinition.create({
        version: 4,
        tableId,
        kind: 'aggregate',
        aggregates: [
          {
            expr: formula('1', { secret: reference(priceId) }),
            statisticFunc: 'sum',
            alias: 'value',
          },
        ],
      })
    );
    expect((await denied.execute(context, unused)).isErr()).toBe(true);
  });
  it.each(['metric', 'filter', 'having'] as const)(
    'v4 enforces the %s compile budget equally for execute and explain',
    async (stage) => {
      const table = resultValue(new DefaultTableMapper().toDomain(tableDto));
      const repository = { findOne: async () => ok(table) };
      const plugins = new RecordQueryPluginRunner([], new NoopLogger());
      const options = {
        formulaCompileBudget: {
          policy: createFormulaCompileBudgetPolicy({
            ...defaultFormulaCompileBudgetLimits,
            visitedNodes: 0,
          }),
          policyVersion: 1,
        },
      };
      const definition = resultValue(
        DataQueryDefinition.create({
          version: 4,
          tableId,
          kind: 'aggregate',
          aggregates:
            stage === 'metric'
              ? [{ expr: formula('1'), statisticFunc: 'sum', alias: 'value' }]
              : [
                  {
                    fieldId: quantityId,
                    statisticFunc: 'sum',
                    alias: 'value',
                    ...(stage === 'filter' ? { filter: formula('1 = 1') } : {}),
                  },
                ],
          ...(stage === 'having'
            ? { having: { type: 'formula', formula: '1 = 1', references: {} } }
            : {}),
        })
      );
      const executor = new DataQueryService(
        repository,
        plugins,
        new PostgresDataQueryExecutor(database.db, options)
      );
      const explainer = new DataQueryExplainService(
        repository,
        plugins,
        new PostgresDataQueryExplainer(database.db, options)
      );
      for (const result of [
        await executor.execute(context, definition),
        await explainer.explain(context, definition),
      ]) {
        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr()).toMatchObject({
          code: 'validation.limit.formula_compile_nodes_max',
          details: { metric: 'visitedNodes', max: 0, policyVersion: 1 },
        });
      }
    }
  );

  it('v4 filters grouped output aliases before sorting and paging and treats blank HAVING as false', async () => {
    const definition = resultValue(
      DataQueryDefinition.create({
        version: 4,
        tableId,
        kind: 'aggregate',
        parameters: { minimum: { type: 'number' } },
        groupBy: [{ fieldId: titleId, alias: 'label' }],
        aggregates: [{ expr: netAmount, statisticFunc: 'sum', alias: 'revenue' }],
        having: {
          type: 'formula',
          formula: 'AND({revenue} >= {minimum}, {label} != "GAMMA")',
          references: {
            revenue: { type: 'output', alias: 'revenue' },
            label: { type: 'output', alias: 'label' },
            minimum: { type: 'parameter', name: 'minimum' },
          },
        },
        sort: [{ alias: 'revenue', order: 'desc' }],
        page: { limit: 1, includeTotal: true },
      })
    );
    expect(
      resultValue(await service.execute(context, definition, { parameters: { minimum: 10 } }))
    ).toEqual({
      rows: [{ label: 'Beta', revenue: 27 }],
      page: { limit: 1, offset: 0, total: 2 },
    });
    const blank = resultValue(
      DataQueryDefinition.create({
        ...definition.snapshot(),
        having: {
          type: 'formula',
          formula: 'IF({revenue} > 0, BLANK(), 1 = 1)',
          references: {
            revenue: { type: 'output', alias: 'revenue' },
          },
        },
      })
    );
    expect(
      resultValue(await service.execute(context, blank, { parameters: { minimum: 10 } }))
    ).toEqual({
      rows: [],
      page: { limit: 1, offset: 0, total: 0 },
    });
  });

  it.each([
    { alias: 'record', order: ['recC', 'recB', 'recA'] },
    { alias: 'stored', order: ['recC', 'recB', 'recA'] },
    { alias: 'band', order: ['recA', 'recB', 'recC'] },
  ])('sorts selected v3 output aliases: $alias', async ({ alias, order }) => {
    const parsed = DataQueryDefinition.create({
      version: 3,
      tableId,
      kind: 'records',
      select: [
        { system: 'id', alias: 'record' },
        { fieldId: quantityId, alias: 'stored' },
        {
          fieldId: quantityId,
          alias: 'band',
          bucket: {
            kind: 'numericRange',
            edges: [{ maxExclusive: 3, label: 'low' }],
            fallbackLabel: 'high',
          },
        },
      ],
      sort: [{ alias, order: 'desc' }],
      page: { limit: 10, includeTotal: true },
    });
    if (parsed.isErr()) throw new Error(`Alias definition: ${JSON.stringify(parsed.error)}`);
    const definition = parsed.value;
    const validated = await service.validate(context, definition);
    if (validated.isErr()) throw new Error(`Alias validation: ${JSON.stringify(validated.error)}`);
    expect(validated.value.outputs.map((output) => output.alias)).toEqual([
      'record',
      'stored',
      'band',
    ]);
    const executed = await service.execute(context, definition);
    if (executed.isErr()) throw new Error(`Alias execution: ${JSON.stringify(executed.error)}`);
    const expected = {
      recA: { record: 'recA', stored: 2, band: 'low' },
      recB: { record: 'recB', stored: 3, band: 'high' },
      recC: { record: 'recC', stored: 5, band: 'high' },
    };
    expect(executed.value.rows).toEqual(order.map((id) => expected[id as keyof typeof expected]));
    expect(executed.value.page).toEqual({ limit: 10, offset: 0, total: 3 });
    const mapped = new DefaultTableMapper().toDomain(tableDto);
    if (mapped.isErr()) throw new Error(`Alias live table: ${JSON.stringify(mapped.error)}`);
    const explainer = new DataQueryExplainService(
      { findOne: async () => ok(mapped.value) },
      new RecordQueryPluginRunner([], new NoopLogger()),
      new PostgresDataQueryExplainer(database.db)
    );
    const explained = await explainer.explain(context, definition);
    if (explained.isErr()) throw new Error(`Alias explain: ${JSON.stringify(explained.error)}`);
    expect(explained.value.sql).toContain('order by');
    expect(explained.value.plan.analyzed).toBe(false);
  });

  it.each(['expression', 'stored', 'system', 'bucket'] as const)(
    'keeps scalar null placement and stable ties for selected alias: %s',
    async (kind) => {
      await sql`update ${sql.id('public', physicalTable)} set
        due_at = case when __id = 'recA' then due_at else null end,
        __last_modified_time = case when __id = 'recA' then due_at else null end`.execute(
        database.db
      );
      const selection =
        kind === 'expression'
          ? { expr: field(occurredAtId), alias: 'value' }
          : kind === 'system'
            ? { system: 'lastModifiedTime', alias: 'value' }
            : kind === 'bucket'
              ? {
                  fieldId: occurredAtId,
                  alias: 'value',
                  bucket: { kind: 'dateTrunc', unit: 'day', timeZone: 'UTC' },
                }
              : { fieldId: occurredAtId, alias: 'value' };
      for (const order of ['asc', 'desc'] as const) {
        for (const nulls of [undefined, 'first', 'last'] as const) {
          const definition = DataQueryDefinition.create({
            version: 3,
            tableId,
            kind: 'records',
            select: [{ system: 'id', alias: 'id' }, selection],
            sort: [{ alias: 'value', order, ...(nulls === undefined ? {} : { nulls }) }],
            page: { limit: 10, includeTotal: true },
          })._unsafeUnwrap();
          const result = (await service.execute(context, definition))._unsafeUnwrap();
          expect(
            result.rows.map((row) => row.id),
            `${order} nulls ${nulls ?? 'implicit'}`
          ).toEqual(
            (nulls ?? (order === 'asc' ? 'first' : 'last')) === 'first'
              ? ['recB', 'recC', 'recA']
              : ['recA', 'recB', 'recC']
          );
          expect(result.page?.total).toBe(3);
        }
      }
    }
  );

  it('sorts selected v3 output aliases ahead of colliding input column names', async () => {
    const parsed = DataQueryDefinition.create({
      version: 3,
      tableId,
      kind: 'records',
      select: [
        { system: 'id', alias: 'id' },
        { fieldId: priceId, alias: 'quantity' },
      ],
      sort: [{ alias: 'quantity', order: 'asc' }],
    });
    if (parsed.isErr()) throw new Error(`Collision definition: ${JSON.stringify(parsed.error)}`);
    const validated = await service.validate(context, parsed.value);
    if (validated.isErr())
      throw new Error(`Collision validation: ${JSON.stringify(validated.error)}`);
    const result = await service.execute(context, parsed.value);
    if (result.isErr()) throw new Error(`Collision execution: ${JSON.stringify(result.error)}`);
    // Input quantities sort A/B/C; the selected unit-price label sorts B/C/A.
    expect(result.value.rows).toEqual([
      { id: 'recB', quantity: 4 },
      { id: 'recC', quantity: 6 },
      { id: 'recA', quantity: 10 },
    ]);
  });

  it('widens required field expression nullability for masks', async () => {
    await sql`alter table ${sql.id('public', physicalTable)} alter column title set not null`.execute(
      database.db
    );
    const mapped = new DefaultTableMapper().toDomain({
      ...tableDto,
      fields: tableDto.fields.map((stored) =>
        stored.id === titleId ? { ...stored, notNull: true } : stored
      ),
    });
    if (mapped.isErr()) throw new Error(`Required live table: ${JSON.stringify(mapped.error)}`);
    const table = mapped.value;
    const condition = buildRecordConditionSpec(table, {
      fieldId: quantityId,
      operator: 'isGreater',
      value: 3,
    });
    if (condition.isErr())
      throw new Error(`Required title visibility: ${JSON.stringify(condition.error)}`);
    const plugin: IRecordQueryPlugin = {
      name: 'required-title-mask',
      supports: () => true,
      scope: () => ok({ fieldMasks: [{ fieldId: titleId, visibleWhen: condition.value }] }),
    };
    const masked = new DataQueryService(
      { findOne: async () => ok(table) },
      new RecordQueryPluginRunner([plugin], new NoopLogger()),
      new PostgresDataQueryExecutor(database.db)
    );
    const parsed = DataQueryDefinition.create({
      version: 3,
      tableId,
      kind: 'records',
      select: [
        { system: 'id', alias: 'id' },
        { expr: formula('LOWER({title})', { title: reference(titleId) }), alias: 'normalized' },
      ],
    });
    if (parsed.isErr())
      throw new Error(`Required title definition: ${JSON.stringify(parsed.error)}`);
    const validated = await masked.validate(context, parsed.value);
    if (validated.isErr())
      throw new Error(`Required title validation: ${JSON.stringify(validated.error)}`);
    expect(validated.value.outputs.find((output) => output.alias === 'normalized')).toMatchObject({
      wireType: 'string',
      nullable: true,
    });
    const executed = await masked.execute(context, parsed.value);
    if (executed.isErr())
      throw new Error(`Required title execution: ${JSON.stringify(executed.error)}`);
    expect(executed.value.rows).toEqual([
      { id: 'recA', normalized: null },
      { id: 'recB', normalized: null },
      { id: 'recC', normalized: 'beta' },
    ]);
  });

  it('compiles nested formula depth without duplicating operand binds and executes each correlated operand', async () => {
    const table = new DefaultTableMapper().toDomain(tableDto)._unsafeUnwrap();
    const executor = new PostgresDataQueryExecutor(database.db);
    const nested = (depth: number): DataQueryFormulaExpression => {
      let text = 'IF({discount}, {discount}, 1)';
      for (let index = 0; index < depth; index++) text = `VALUE(CONCATENATE(${text}))`;
      return formula(text, { discount: reference(discountId) });
    };
    const compiled = [1, 4].map((depth) => {
      const definition = records({ value: nested(depth) });
      const binding = DataQueryBinding.prepare(definition, table)._unsafeUnwrap();
      const query = definition.bind({})._unsafeUnwrap();
      return {
        definition,
        sql: executor.compile(context, table, query, {}, binding)._unsafeUnwrap(),
      };
    });
    const [shallow, deep] = compiled;
    // Formula depth does not multiply the row's operand binds: both depths carry
    // exactly the reference inputs, and SQL grows linearly rather than per node.
    expect(deep.sql.parameters.length).toBe(shallow.sql.parameters.length);
    expect(deep.sql.sql.length).toBeLessThan(shallow.sql.sql.length * 4);
    expect((await service.execute(context, deep.definition))._unsafeUnwrap().rows).toEqual([
      { id: 'recA', value: 5 },
      { id: 'recB', value: 1 },
      { id: 'recC', value: 3 },
    ]);
  });

  it('propagates the configured formula compile budget through execute and explain', async () => {
    const table = new DefaultTableMapper().toDomain(tableDto)._unsafeUnwrap();
    const repository = { findOne: async () => ok(table) };
    const plugins = new RecordQueryPluginRunner([], new NoopLogger());
    const options = {
      formulaCompileBudget: {
        policy: createFormulaCompileBudgetPolicy({
          ...defaultFormulaCompileBudgetLimits,
          visitedNodes: 0,
        }),
        policyVersion: 1,
      },
    };
    const definition = records({ value: formula('1') });
    const constrainedService = new DataQueryService(
      repository,
      plugins,
      new PostgresDataQueryExecutor(database.db, options)
    );
    const constrainedExplain = new DataQueryExplainService(
      repository,
      plugins,
      new PostgresDataQueryExplainer(database.db, options)
    );

    const executed = await constrainedService.execute(context, definition);
    const explained = await constrainedExplain.explain(context, definition);
    for (const result of [executed, explained]) {
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toMatchObject({
        code: 'validation.limit.formula_compile_nodes_max',
        details: { metric: 'visitedNodes', max: 0, policyVersion: 1 },
      });
    }
  });
  it('finalizes numeric formulas as float8 while preserving raw int8 and NUMERIC source text', async () => {
    const counterId = `fld${'u'.repeat(16)}`;
    const numericId = `fld${'v'.repeat(16)}`;
    const jsonNumericId = `fld${'w'.repeat(16)}`;
    const table = new DefaultTableMapper()
      .toDomain({
        ...tableDto,
        fields: [
          ...tableDto.fields,
          {
            id: counterId,
            name: 'Native counter',
            type: 'autoNumber',
            dbFieldName: 'native_counter',
            dbFieldType: 'BIGINT',
            options: { expression: 'AUTO_NUMBER()' },
          },
          {
            id: numericId,
            name: 'Precise number',
            type: 'number',
            dbFieldName: 'native_numeric',
            dbFieldType: 'NUMERIC',
          },
          {
            id: jsonNumericId,
            name: 'JSON numeric snapshot',
            type: 'formula',
            dbFieldName: 'json_numeric',
            dbFieldType: 'JSON',
            options: { expression: '1' },
            cellValueType: 'number',
            isMultipleCellValue: false,
          },
        ],
      })
      ._unsafeUnwrap();
    await sql`alter table ${sql.id('public', physicalTable)}
      add column native_counter bigint, add column native_numeric numeric,
      add column json_numeric jsonb`.execute(database.db);
    await sql`update ${sql.id('public', physicalTable)} set
      native_counter = ${'9007199254740993'}::bigint,
      native_numeric = ${'9007199254740993.125'}::numeric,
      json_numeric = ${'9007199254740993.125'}::jsonb where __id = 'recA'`.execute(database.db);
    const exactService = new DataQueryService(
      { findOne: async () => ok(table) },
      new RecordQueryPluginRunner([], new NoopLogger()),
      new PostgresDataQueryExecutor(database.db)
    );
    const compared = (boundary: 'literal' | 'parameter'): DataQueryFormulaExpression =>
      formula(
        boundary === 'literal'
          ? 'IF({counter} = 9007199254740992, "rounded", "exact")'
          : 'IF({counter} = {boundary}, "rounded", "exact")',
        {
          counter: reference(counterId),
          ...(boundary === 'parameter' ? { boundary: parameterReference('boundary') } : {}),
        }
      );
    const definition = records(
      {
        counter: field(counterId),
        counterText: formula('CONCATENATE({counter})', { counter: reference(counterId) }),
        numeric: field(numericId),
        numericText: formula('CONCATENATE({value})', { value: reference(numericId) }),
        jsonNumeric: field(jsonNumericId),
        jsonText: formula('CONCATENATE({value})', { value: reference(jsonNumericId) }),
        coalesced: formula('IF({counter}, {counter}, 0)', { counter: reference(counterId) }),
        nullified: formula('IF({counter} = 9007199254740992, BLANK(), {counter})', {
          counter: reference(counterId),
        }),
        literalComparison: compared('literal'),
        parameterComparison: compared('parameter'),
      },
      {
        filter: onlyAlpha,
        parameters: { boundary: { type: 'number' } },
      }
    );
    const result = (
      await exactService.execute(context, definition, {
        parameters: { boundary: 9007199254740992 },
      })
    )._unsafeUnwrap();
    expect(result.rows).toEqual([
      {
        id: 'recA',
        counter: 9007199254740992,
        counterText: '9007199254740993',
        numeric: 9007199254740994,
        numericText: '9007199254740993.125',
        jsonNumeric: 9007199254740994,
        jsonText: '9007199254740993.125',
        coalesced: 9007199254740992,
        nullified: null,
        literalComparison: 'rounded',
        parameterComparison: 'rounded',
      },
    ]);
    const direct = DataQueryDefinition.create({
      version: 3,
      kind: 'records',
      tableId,
      filter: onlyAlpha,
      select: [
        { fieldId: counterId, alias: 'counter' },
        { fieldId: numericId, alias: 'numeric' },
      ],
    })._unsafeUnwrap();
    expect((await exactService.execute(context, direct))._unsafeUnwrap().rows).toEqual([
      { counter: '9007199254740993', numeric: '9007199254740993.125' },
    ]);
  });

  it('evaluates native and JSON-backed scalar computed snapshots through live metadata', async () => {
    const formulaId = `fld${'f'.repeat(16)}`;
    const textFormulaId = `fld${'g'.repeat(16)}`;
    const linkId = `fld${'h'.repeat(16)}`;
    const numberLookupId = `fld${'i'.repeat(16)}`;
    const textLookupId = `fld${'j'.repeat(16)}`;
    const rollupId = `fld${'k'.repeat(16)}`;
    const jsonNumberLookupId = `fld${'l'.repeat(16)}`;
    const jsonTextLookupId = `fld${'n'.repeat(16)}`;
    const foreignTableId = `tbl${'c'.repeat(16)}`;
    const foreignNumberId = `fld${'r'.repeat(16)}`;
    const foreignTextId = `fld${'s'.repeat(16)}`;
    const lookupOptions = (lookupFieldId: string) => ({
      linkFieldId: linkId,
      foreignTableId,
      lookupFieldId,
    });
    const computedDto: ITablePersistenceDTO = {
      ...tableDto,
      fields: [
        ...tableDto.fields,
        {
          id: linkId,
          name: 'Computed source',
          type: 'link',
          dbFieldName: 'computed_link',
          options: {
            relationship: 'manyOne',
            foreignTableId,
            lookupFieldId: foreignTextId,
            isOneWay: true,
            fkHostTableName: `public.${physicalTable}`,
            selfKeyName: '__id',
            foreignKeyName: 'fk_computed_target',
          },
        },
        {
          id: formulaId,
          name: 'Stored scalar formula',
          type: 'formula',
          dbFieldName: 'computed_number',
          dbFieldType: 'REAL',
          options: { expression: `{${quantityId}} * {${priceId}}` },
          cellValueType: 'number',
          isMultipleCellValue: false,
        },
        {
          id: textFormulaId,
          name: 'Stored text formula',
          type: 'formula',
          dbFieldName: 'computed_text',
          dbFieldType: 'TEXT',
          options: { expression: `LOWER({${emailId}})` },
          cellValueType: 'string',
          isMultipleCellValue: false,
        },
        {
          id: numberLookupId,
          name: 'Scalar number lookup',
          type: 'number',
          isLookup: true,
          dbFieldName: 'lookup_number',
          dbFieldType: 'REAL',
          options: {},
          lookupOptions: lookupOptions(foreignNumberId),
          cellValueType: 'number',
          isMultipleCellValue: false,
        },
        {
          id: textLookupId,
          name: 'Scalar text lookup',
          type: 'singleLineText',
          isLookup: true,
          dbFieldName: 'lookup_text',
          dbFieldType: 'TEXT',
          options: {},
          lookupOptions: lookupOptions(foreignTextId),
          cellValueType: 'string',
          isMultipleCellValue: false,
        },
        {
          id: rollupId,
          name: 'Scalar rollup',
          type: 'rollup',
          dbFieldName: 'rollup_number',
          dbFieldType: 'REAL',
          options: { expression: 'sum({values})' },
          config: lookupOptions(foreignNumberId),
          cellValueType: 'number',
          isMultipleCellValue: false,
        },
        {
          id: jsonNumberLookupId,
          name: 'JSON scalar number lookup',
          type: 'number',
          isLookup: true,
          dbFieldName: 'lookup_json_number',
          dbFieldType: 'JSON',
          options: {},
          lookupOptions: lookupOptions(foreignNumberId),
          cellValueType: 'number',
          isMultipleCellValue: false,
        },
        {
          id: jsonTextLookupId,
          name: 'JSON scalar text lookup',
          type: 'singleLineText',
          isLookup: true,
          dbFieldName: 'lookup_json_text',
          dbFieldType: 'JSON',
          options: {},
          lookupOptions: lookupOptions(foreignTextId),
          cellValueType: 'string',
          isMultipleCellValue: false,
        },
      ],
    };
    const mapper = new DefaultTableMapper();
    const mappedTable = mapper.toDomain(computedDto);
    if (mappedTable.isErr())
      throw new Error(`Computed live table: ${JSON.stringify(mappedTable.error)}`);
    const table = mappedTable.value;
    const foreign = mapper
      .toDomain({
        id: foreignTableId,
        baseId: tableDto.baseId,
        name: 'Computed source',
        dbTableName: 'public.expression_computed_source',
        primaryFieldId: foreignTextId,
        fields: [
          { id: foreignNumberId, name: 'Number', type: 'number', dbFieldName: 'amount' },
          { id: foreignTextId, name: 'Text', type: 'singleLineText', dbFieldName: 'label' },
        ],
        views: [{ id: `viw${'c'.repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
      })
      ._unsafeUnwrap();
    for (const id of [numberLookupId, textLookupId, jsonNumberLookupId, jsonTextLookupId]) {
      const lookup = table
        .getField((candidate) => candidate.id().toString() === id)
        ._unsafeUnwrap();
      if (!(lookup instanceof LookupField)) throw new Error('Expected live lookup metadata');
      lookup.validateForeignTables({ hostTable: table, foreignTables: [foreign] })._unsafeUnwrap();
    }
    await sql`create table public.expression_computed_source
      (__id text primary key, amount double precision, label text)`.execute(database.db);
    await sql`insert into public.expression_computed_source values
      ('sourceA', 10, 'ALPHA'), ('sourceC', 6, 'Beta')`.execute(database.db);
    await sql`alter table ${sql.id('public', physicalTable)}
      add column computed_link jsonb, add column fk_computed_target text,
      add column computed_number double precision, add column computed_text text,
      add column lookup_number double precision, add column lookup_text text,
      add column rollup_number double precision,
      add column lookup_json_number jsonb, add column lookup_json_text jsonb`.execute(database.db);
    await sql`update ${sql.id('public', physicalTable)} set
      computed_number = quantity * unit_price, computed_text = lower(email),
      fk_computed_target = case when __id = 'recA' then 'sourceA' when __id = 'recC' then 'sourceC' end`.execute(
      database.db
    );
    await sql`update ${sql.id('public', physicalTable)} as host set
      lookup_number = source.amount, lookup_text = source.label, rollup_number = source.amount,
      lookup_json_number = to_jsonb(source.amount), lookup_json_text = to_jsonb(source.label)
      from public.expression_computed_source as source where host.fk_computed_target = source.__id`.execute(
      database.db
    );
    const computedService = new DataQueryService(
      { findOne: async () => ok(table) },
      new RecordQueryPluginRunner([], new NoopLogger()),
      new PostgresDataQueryExecutor(database.db)
    );
    const definition = records(
      {
        formula: formula('{stored} + 1', { stored: reference(formulaId) }),
        textFormula: formula('UPPER({text})', { text: reference(textFormulaId) }),
        lookup: formula('{amount} * 2', { amount: reference(numberLookupId) }),
        textLookup: formula('LOWER({text})', { text: reference(textLookupId) }),
        rollup: formula('{total} + {stored}', {
          total: reference(rollupId),
          stored: reference(formulaId),
        }),
        jsonLookup: formula('{amount} / 2', { amount: reference(jsonNumberLookupId) }),
        jsonTextLookup: formula('LOWER({text})', { text: reference(jsonTextLookupId) }),
      },
      { page: { limit: 10, includeTotal: true } }
    );
    const executed = await computedService.execute(context, definition);
    if (executed.isErr()) {
      const binding = DataQueryBinding.prepare(definition, table)._unsafeUnwrap();
      const compiled = new PostgresDataQueryExecutor(database.db).compile(
        context,
        table,
        definition.bind({})._unsafeUnwrap(),
        {},
        binding
      );
      throw new Error(
        `Computed execution: ${JSON.stringify(executed.error)} SQL: ${compiled.isOk() ? compiled.value.sql : JSON.stringify(compiled.error)}`
      );
    }
    const result = executed.value;
    expect(result).toMatchObject({
      rows: [
        {
          id: 'recA',
          formula: 21,
          textFormula: 'ALPHA@EXAMPLE.COM',
          lookup: 20,
          textLookup: 'alpha',
          rollup: 30,
          jsonLookup: 5,
          jsonTextLookup: 'alpha',
        },
        {
          id: 'recB',
          formula: 13,
          textFormula: null,
          lookup: 0,
          textLookup: null,
          rollup: 12,
          jsonLookup: 0,
          jsonTextLookup: null,
        },
        {
          id: 'recC',
          formula: 31,
          textFormula: 'BETA@EXAMPLE.COM',
          lookup: 12,
          textLookup: 'beta',
          rollup: 36,
          jsonLookup: 3,
          jsonTextLookup: 'beta',
        },
      ],
      page: { limit: 10, offset: 0, total: 3 },
    });
    const filtered = records(
      { amount: field(formulaId) },
      {
        filter: formula('{stored} + {lookup} > 30', {
          stored: reference(formulaId),
          lookup: reference(numberLookupId),
        }),
        sort: [{ alias: 'amount', order: 'desc' }],
        page: { limit: 10, includeTotal: true },
      }
    );
    expect((await computedService.execute(context, filtered))._unsafeUnwrap()).toMatchObject({
      rows: [{ id: 'recC', amount: 30 }],
      page: { limit: 10, offset: 0, total: 1 },
    });
  });

  it('computes scalar projections and parameterized predicates before alias sorting and paging', async () => {
    const parsed = DataQueryDefinition.create({
      version: 3,
      tableId,
      kind: 'records',
      parameters: { minimum: { type: 'number' } },
      select: [
        { system: 'id', alias: 'id' },
        { expr: netAmount, alias: 'net' },
        {
          expr: formula('LOWER({title})', { title: reference(titleId) }),
          alias: 'normalized',
        },
        { expr: formula('LOWER({email})', { email: reference(emailId) }), alias: 'email' },
        {
          expr: formula('IF({paid}, "paid", "unpaid")', { paid: reference(paidId) }),
          alias: 'payment',
        },
      ],
      filter: formula(`(${netAmount.formula}) >= {minimum}`, {
        ...netAmount.references,
        minimum: parameterReference('minimum'),
      }),
      sort: [{ alias: 'net', order: 'desc' }],
      page: { limit: 2, offset: 0, includeTotal: true },
    });
    if (parsed.isErr()) throw new Error(JSON.stringify(parsed.error));
    const definition = parsed.value;

    const first = (
      await service.execute(context, definition, { parameters: { minimum: 15 } })
    )._unsafeUnwrap();
    expect(first.rows).toEqual([
      { id: 'recC', net: 27, normalized: 'beta', email: 'beta@example.com', payment: 'unpaid' },
      { id: 'recA', net: 15, normalized: 'alpha', email: 'alpha@example.com', payment: 'paid' },
    ]);
    expect(first.page).toEqual({ limit: 2, offset: 0, total: 2 });

    const followUp = (
      await service.execute(context, definition, { parameters: { minimum: 20 } })
    )._unsafeUnwrap();
    expect(followUp.rows).toEqual([
      { id: 'recC', net: 27, normalized: 'beta', email: 'beta@example.com', payment: 'unpaid' },
    ]);
    expect(followUp.page).toEqual({ limit: 2, offset: 0, total: 1 });
  });

  it('evaluates arithmetic, blank handling and IF fallbacks with Teable coercion', async () => {
    const definition = records({
      sum: formula('{quantity} + {price}', {
        quantity: reference(quantityId),
        price: reference(priceId),
      }),
      difference: formula('{price} - {quantity}', {
        price: reference(priceId),
        quantity: reference(quantityId),
      }),
      product: formula('{quantity} * {price}', {
        quantity: reference(quantityId),
        price: reference(priceId),
      }),
      quotient: formula('{price} / {quantity}', {
        price: reference(priceId),
        quantity: reference(quantityId),
      }),
      negative: formula('-{quantity}', { quantity: reference(quantityId) }),
      discount: formula('IF({discount} = 3, BLANK(), {discount})', {
        discount: reference(discountId),
      }),
      strictNull: formula('{discount} + 1', { discount: reference(discountId) }),
      fallback: formula('IF({discount}, {discount}, 0)', { discount: reference(discountId) }),
    });
    const result = (await service.execute(context, definition))._unsafeUnwrap();
    expect(result.rows).toEqual([
      {
        id: 'recA',
        sum: 12,
        difference: 8,
        product: 20,
        quotient: 5,
        negative: -2,
        discount: 5,
        strictNull: 6,
        fallback: 5,
      },
      {
        id: 'recB',
        sum: 7,
        difference: 1,
        product: 12,
        quotient: 1.3333333333333333,
        negative: -3,
        discount: null,
        strictNull: 1,
        fallback: 0,
      },
      {
        id: 'recC',
        sum: 11,
        difference: 1,
        product: 30,
        quotient: 1.2,
        negative: -5,
        discount: null,
        strictNull: 4,
        fallback: 3,
      },
    ]);
  });

  it('evaluates text functions, VALUE coercion and concat null handling', async () => {
    const definition = records(
      {
        lower: formula('LOWER({title})', { title: reference(titleId) }),
        upper: formula('UPPER({title})', { title: reference(titleId) }),
        length: formula('LEN({title})', { title: reference(titleId) }),
        joined: formula('CONCATENATE("[", LOWER({title}), BLANK(), "]")', {
          title: reference(titleId),
        }),
        nullText: formula('LOWER(BLANK())'),
        number: formula('VALUE({number})', { number: parameterReference('number') }),
        boolean: formula('IF({boolean}, TRUE, FALSE)', {
          boolean: parameterReference('boolean'),
        }),
        numericText: formula('CONCATENATE({quantity})', { quantity: reference(quantityId) }),
        booleanText: formula('CONCATENATE(TRUE)'),
      },
      {
        parameters: { number: { type: 'string' }, boolean: { type: 'string' } },
      }
    );
    const result = (
      await service.execute(context, definition, {
        parameters: { number: ' -125 ', boolean: ' TrUe ' },
      })
    )._unsafeUnwrap();
    expect(result.rows).toEqual([
      {
        id: 'recA',
        lower: 'alpha',
        upper: 'ALPHA',
        length: 5,
        joined: '[alpha]',
        nullText: null,
        number: -125,
        boolean: true,
        numericText: '2',
        booleanText: 'true',
      },
      {
        id: 'recB',
        lower: 'gamma',
        upper: 'GAMMA',
        length: 5,
        joined: '[gamma]',
        nullText: null,
        number: -125,
        boolean: true,
        numericText: '3',
        booleanText: 'true',
      },
      {
        id: 'recC',
        lower: 'beta',
        upper: 'BETA',
        length: 4,
        joined: '[beta]',
        nullText: null,
        number: -125,
        boolean: true,
        numericText: '5',
        booleanText: 'true',
      },
    ]);
    const falsy = (
      await service.execute(context, definition, {
        parameters: { number: '0', boolean: ' FALSE ' },
      })
    )._unsafeUnwrap();
    expect(falsy.rows.map((row) => row.boolean)).toEqual([false, false, false]);
  });

  it('does not evaluate unselected IF branches or unused IF fallbacks', async () => {
    const definition = records({
      branch: formula(
        'IF({quantity} > 0, {quantity}, IF(1 = 1, VALUE({title}), {price} / ({quantity} - {quantity})))',
        {
          quantity: reference(quantityId),
          price: reference(priceId),
          title: reference(titleId),
        }
      ),
      coalesced: formula('IF({quantity}, {quantity}, VALUE({title}))', {
        quantity: reference(quantityId),
        title: reference(titleId),
      }),
      withoutElse: formula('IF({discount} = BLANK(), "missing", BLANK())', {
        discount: reference(discountId),
      }),
    });
    expect((await service.execute(context, definition))._unsafeUnwrap().rows).toEqual([
      { id: 'recA', branch: 2, coalesced: 2, withoutElse: null },
      { id: 'recB', branch: 3, coalesced: 3, withoutElse: 'missing' },
      { id: 'recC', branch: 5, coalesced: 5, withoutElse: null },
    ]);
  });
  it('keeps mixed OR/NOT grouping while pruning only absent optional legacy leaves', async () => {
    const definition = records(
      {},
      {
        parameters: { title: { type: 'string' } },
        filter: {
          conjunction: 'or',
          items: [
            {
              fieldId: titleId,
              operator: 'is',
              value: { type: 'parameter', name: 'title' },
              optional: true,
            },
            { not: formula('{quantity} < 5', { quantity: reference(quantityId) }) },
          ],
        },
      }
    );
    expect((await service.execute(context, definition))._unsafeUnwrap().rows).toEqual([
      { id: 'recC' },
    ]);
    expect(
      (
        await service.execute(context, definition, {
          parameters: { title: 'ALPHA' },
        })
      )._unsafeUnwrap().rows
    ).toEqual([{ id: 'recA' }, { id: 'recC' }]);

    const negated = records(
      {},
      {
        parameters: { title: { type: 'string' } },
        filter: {
          not: {
            conjunction: 'or',
            items: [
              {
                fieldId: titleId,
                operator: 'is',
                value: { type: 'parameter', name: 'title' },
                optional: true,
              },
              formula('{quantity} >= 5', { quantity: reference(quantityId) }),
            ],
          },
        },
      }
    );
    expect((await service.execute(context, negated))._unsafeUnwrap().rows).toEqual([
      { id: 'recA' },
      { id: 'recB' },
    ]);
    expect(
      (
        await service.execute(context, negated, {
          parameters: { title: 'ALPHA' },
        })
      )._unsafeUnwrap().rows
    ).toEqual([{ id: 'recB' }]);

    const prunedNot = records(
      {},
      {
        parameters: { title: { type: 'string' } },
        filter: {
          conjunction: 'and',
          items: [
            {
              not: {
                fieldId: titleId,
                operator: 'is',
                value: { type: 'parameter', name: 'title' },
                optional: true,
              },
            },
            formula('{discount} = BLANK()', { discount: reference(discountId) }),
          ],
        },
      }
    );
    expect((await service.execute(context, prunedNot))._unsafeUnwrap().rows).toEqual([
      { id: 'recB' },
    ]);
  });

  it.each([
    ['checkbox', '{paid}', { paid: reference(paidId) }],
    ['date comparison', '{date} > DATETIME_PARSE("2026-03-01")', { date: reference(occurredAtId) }],
    [
      'IS_AFTER',
      'IS_AFTER({date}, DATETIME_PARSE("2026-03-01"))',
      { date: reference(occurredAtId) },
    ],
    [
      'IS_SAME',
      'IS_SAME({date}, DATETIME_PARSE("2026-03-07"), "day")',
      { date: reference(occurredAtId) },
    ],
    [
      'blank result',
      'IF({discount} = BLANK(), BLANK(), {discount} > 3)',
      { discount: reference(discountId) },
    ],
  ] as const)(
    'complements blank formula truthiness under external NOT: %s',
    async (_name, text, references) => {
      await sql`update ${sql.id('public', physicalTable)} set due_at = case
      when __id = 'recA' then '2026-03-07T17:00:00Z'::timestamptz
      when __id = 'recB' then null else '2026-02-01T00:00:00Z'::timestamptz end`.execute(
        database.db
      );
      const predicate = formula(text, references);
      const execute = async (filter: unknown) => {
        const result = await service.execute(context, records({}, { filter }));
        if (result.isErr()) throw new Error(`${text}: ${JSON.stringify(result.error)}`);
        return result.value.rows;
      };
      const positive = await execute(predicate);
      const expected = ['recA', 'recB', 'recC']
        .filter((id) => !positive.some((row) => row.id === id))
        .map((id) => ({ id }));
      expect(expected).toEqual([{ id: 'recB' }, { id: 'recC' }]);
      expect(await execute(formula(`NOT(${text})`, references))).toEqual(expected);
      expect(await execute({ not: predicate })).toEqual(expected);
      expect(
        await execute({
          not: {
            conjunction: 'or',
            items: [predicate, { conjunction: 'and', items: [predicate, formula('1 = 1')] }],
          },
        })
      ).toEqual(expected);
      const aggregate = DataQueryDefinition.create({
        version: 3,
        tableId,
        kind: 'aggregate',
        filter: { not: predicate },
        aggregates: [{ fieldId: quantityId, statisticFunc: 'sum', alias: 'quantity' }],
      })._unsafeUnwrap();
      expect((await service.execute(context, aggregate))._unsafeUnwrap().rows).toEqual([
        { quantity: 8 },
      ]);
    }
  );

  it('normalizes only formula blanks under NOT without exposing masked operands or legacy blanks', async () => {
    const table = new DefaultTableMapper().toDomain(tableDto)._unsafeUnwrap();
    const visibleWhen = buildRecordConditionSpec(table, {
      fieldId: titleId,
      operator: 'is',
      value: 'ALPHA',
    })._unsafeUnwrap();
    // recB is really true, but its permission-masked value must behave just like recC's blank.
    await sql`update ${sql.id('public', physicalTable)} set paid = true where __id = 'recB'`.execute(
      database.db
    );
    const masked = scopedService({ fieldMasks: [{ fieldId: paidId, visibleWhen }] });
    for (const filter of [
      { not: field(paidId) },
      formula('NOT({paid})', { paid: reference(paidId) }),
    ]) {
      const result = await masked.execute(context, records({}, { filter }));
      if (result.isErr()) throw new Error(`Masked predicate: ${JSON.stringify(result.error)}`);
      expect(result.value.rows).toEqual([{ id: 'recB' }, { id: 'recC' }]);
    }
    const legacy = DataQueryDefinition.create({
      version: 3,
      tableId,
      kind: 'records',
      select: [{ system: 'id', alias: 'id' }],
      filter: { not: { fieldId: paidId, operator: 'is', value: true } },
    });
    if (legacy.isErr()) throw new Error(`Legacy definition: ${JSON.stringify(legacy.error)}`);
    const result = await service.execute(context, legacy.value);
    if (result.isErr()) throw new Error(`Legacy predicate: ${JSON.stringify(result.error)}`);
    expect(result.value.rows).toEqual([]);
  });

  it('applies expression WHERE to source rows before aggregate grouping and totals', async () => {
    const definition = DataQueryDefinition.create({
      version: 3,
      tableId,
      kind: 'aggregate',
      parameters: { minimum: { type: 'number' } },
      filter: formula(`(${netAmount.formula}) >= {minimum}`, {
        ...netAmount.references,
        minimum: parameterReference('minimum'),
      }),
      aggregates: [
        { fieldId: quantityId, statisticFunc: 'sum', alias: 'quantity' },
        { fieldId: quantityId, statisticFunc: 'count', alias: 'count' },
      ],
    })._unsafeUnwrap();
    expect(
      (
        await service.execute(context, definition, {
          parameters: { minimum: 15 },
        })
      )._unsafeUnwrap().rows
    ).toEqual([{ quantity: 7, count: 2 }]);
    expect(
      (
        await service.execute(context, definition, {
          parameters: { minimum: 100 },
        })
      )._unsafeUnwrap().rows
    ).toEqual([{ quantity: null, count: 0 }]);
  });

  it('masks operands before IF fallbacks, filtering and expression alias ordering', async () => {
    const table = new DefaultTableMapper().toDomain(tableDto)._unsafeUnwrap();
    const visibleWhen = buildRecordConditionSpec(table, {
      fieldId: titleId,
      operator: 'is',
      value: 'ALPHA',
    })._unsafeUnwrap();
    const masked = scopedService({ fieldMasks: [{ fieldId: quantityId, visibleWhen }] });
    const fallback = formula('IF({quantity}, {quantity}, 0) + 1', {
      quantity: reference(quantityId),
    });
    const expressions = {
      fallback,
      visibility: formula('IF({quantity} = BLANK(), "hidden", "visible")', {
        quantity: reference(quantityId),
      }),
    };
    const definition = records(expressions, {
      sort: [{ alias: 'fallback', order: 'asc' }],
      page: { limit: 3, includeTotal: true },
    });
    const result = (await masked.execute(context, definition))._unsafeUnwrap();
    expect(result.rows).toEqual([
      { id: 'recB', fallback: 1, visibility: 'hidden' },
      { id: 'recC', fallback: 1, visibility: 'hidden' },
      { id: 'recA', fallback: 3, visibility: 'visible' },
    ]);
    expect(result.page).toEqual({ limit: 3, offset: 0, total: 3 });
    const filtered = records(expressions, {
      filter: formula(`(${fallback.formula}) = 1`, fallback.references),
      page: { limit: 3, includeTotal: true },
    });
    const selected = (await masked.execute(context, filtered))._unsafeUnwrap();
    expect(selected.rows).toEqual([
      { id: 'recB', fallback: 1, visibility: 'hidden' },
      { id: 'recC', fallback: 1, visibility: 'hidden' },
    ]);
    expect(selected.page?.total).toBe(2);
  });

  it.each(['condition', 'then', 'else'] as const)(
    'authorizes fields in every statically possible IF %s even when SQL would not visit it',
    async (position) => {
      const denied = scopedService({ readableFieldIds: new Set([titleId]) });
      const expression = formula(
        {
          condition: 'IF({quantity} > 0, 10, 20)',
          then: 'IF(1 = 0, {quantity}, 20)',
          else: 'IF(1 = 0, 10, {quantity})',
        }[position],
        { quantity: reference(quantityId) }
      );
      const result = await denied.execute(context, records({ value: expression }));
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toMatchObject({ code: 'data_query.field_forbidden' });
    }
  );

  it.each([
    ['VALUE({title})', 'not-a-number-private-sentinel', null],
    ['VALUE({title})', 'NaN', null],
    ['VALUE({title})', 'Infinity', null],
    ['VALUE({title})', '-Infinity', null],
    ['VALUE({title})', '1e9999', null],
    ['IF({title}, "yes", "no")', 't', 'yes'],
    ['IF({title}, "yes", "no")', 'f', 'yes'],
    ['IF({title}, "yes", "no")', 'yes', 'yes'],
    ['IF({title}, "yes", "no")', 'no', 'no'],
    ['IF({title}, "yes", "no")', 'on', 'yes'],
    ['IF({title}, "yes", "no")', 'off', 'no'],
    ['IF({title}, "yes", "no")', '1', 'yes'],
    ['IF({title}, "yes", "no")', '0', 'no'],
    [
      'DATETIME_FORMAT(DATETIME_PARSE({title}, "YYYY-MM-DD"), "YYYY-MM-DD HH:mm:ss")',
      '2026-02-3x',
      null,
    ],
    [parseDateText, '2026-2-03', null],
    [parseText, '2026-03-07T12:00:00', '2026-03-07 12:00:00'],
    [parseText, 'not-a-timestamp', null],
  ] as const)(
    'reports Teable conversion values rather than driver errors for %s on %s',
    async (text, input, expected) => {
      await sql`update ${sql.id('public', physicalTable)} set title = ${input}`.execute(
        database.db
      );
      const result = await service.execute(
        context,
        records({ value: formula(text, { title: reference(titleId) }) }, { filter: onlyAlpha })
      );
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().rows).toEqual([{ id: 'recA', value: expected }]);
      const serialized = JSON.stringify(result._unsafeUnwrap().rows);
      if (input !== expected) expect(serialized).not.toContain(JSON.stringify(input));
      expect(serialized).not.toContain(physicalTable);
      expect(serialized).not.toContain('invalid input syntax');
      expect(serialized).not.toContain('out of range');
      expect(serialized).not.toContain('select ');
    }
  );

  it('guards division by zero to NULL instead of exposing a driver error', async () => {
    const result = await service.execute(
      context,
      records({
        value: formula('{price} / ({quantity} - {quantity})', {
          price: reference(priceId),
          quantity: reference(quantityId),
        }),
      })
    );
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().rows).toEqual([
      { id: 'recA', value: null },
      { id: 'recB', value: null },
      { id: 'recC', value: null },
    ]);
    const serialized = JSON.stringify(result._unsafeUnwrap());
    expect(serialized).not.toContain(physicalTable);
    expect(serialized).not.toContain('22012');
    expect(serialized).not.toContain('select ');
  });

  it('returns fractional elapsed values and finalizes numeric system operands as float8', async () => {
    await sql`update ${sql.id('public', physicalTable)}
      set __auto_number = ${'9007199254740993'}::bigint where __id = 'recA'`.execute(database.db);
    const definition = records(
      {
        seconds: formula('DATETIME_DIFF({end}, {start}, "second")', {
          start: parameterReference('start'),
          end: parameterReference('end'),
        }),
        reverse: formula('DATETIME_DIFF({start}, {end}, "second")', {
          start: parameterReference('start'),
          end: parameterReference('end'),
        }),
        counter: formula('{counter}', { counter: { type: 'system', system: 'autoNumber' } }),
      },
      {
        filter: onlyAlpha,
        parameters: { start: { type: 'string' }, end: { type: 'string' } },
      }
    );
    expect(
      (
        await service.execute(context, definition, {
          parameters: { start: '2026-01-01T00:00:00.125Z', end: '2026-01-01T00:00:01.875Z' },
        })
      )._unsafeUnwrap().rows
    ).toEqual([{ id: 'recA', seconds: 1.75, reverse: -1.75, counter: 9007199254740992 }]);
  });

  it.each([
    {
      start: '2026-03-07T17:00:00Z',
      calendar: '2026-03-08T16:00:00Z',
      elapsed: '2026-03-08T17:00:00Z',
      hours: 23,
    },
    {
      start: '2026-10-31T16:00:00Z',
      calendar: '2026-11-01T17:00:00Z',
      elapsed: '2026-11-01T16:00:00Z',
      hours: 25,
    },
  ])(
    'distinguishes local calendar days from elapsed hours across DST at $start',
    async (example) => {
      const definition = records(
        {
          days: formula(
            'DATETIME_DIFF({calendar}, {start}, "day")',
            {
              calendar: parameterReference('calendar'),
              start: parameterReference('start'),
            },
            'America/New_York'
          ),
          hours: formula(
            'DATETIME_DIFF({calendar}, {start}, "hour")',
            {
              calendar: parameterReference('calendar'),
              start: parameterReference('start'),
            },
            'America/New_York'
          ),
          elapsedHours: formula(
            'DATETIME_DIFF({elapsed}, {start}, "hour")',
            {
              elapsed: parameterReference('elapsed'),
              start: parameterReference('start'),
            },
            'America/New_York'
          ),
          reverseHours: formula(
            'DATETIME_DIFF({start}, {calendar}, "hour")',
            {
              calendar: parameterReference('calendar'),
              start: parameterReference('start'),
            },
            'America/New_York'
          ),
        },
        {
          filter: onlyAlpha,
          parameters: {
            start: { type: 'string' },
            calendar: { type: 'string' },
            elapsed: { type: 'string' },
          },
        }
      );
      expect(
        (
          await service.execute(context, definition, {
            parameters: {
              start: example.start,
              calendar: example.calendar,
              elapsed: example.elapsed,
            },
          })
        )._unsafeUnwrap().rows
      ).toEqual([
        {
          id: 'recA',
          days: 1,
          hours: example.hours,
          elapsedHours: 24,
          reverseHours: -example.hours,
        },
      ]);
    }
  );

  it('uses the declared formula time zone for calendar text, extraction and midnight parsing', async () => {
    const zone = 'America/New_York';
    const definition = records(
      {
        day: formula(
          'DATETIME_FORMAT({when}, "YYYY-MM-DDTHH:mm")',
          { when: reference(occurredAtId) },
          zone
        ),
        week: formula(
          'IS_SAME({when}, DATETIME_PARSE("2026-03-02T05:00:00Z"), "week")',
          { when: reference(occurredAtId) },
          zone
        ),
        month: formula('MONTH({when})', { when: reference(occurredAtId) }, zone),
        localHour: formula('HOUR({when})', { when: reference(occurredAtId) }, zone),
        localDate: formula(
          'DATETIME_FORMAT({when}, "YYYY-MM-DD")',
          { when: reference(occurredAtId) },
          zone
        ),
        localMidnight: formula(
          'DATETIME_FORMAT(DATETIME_PARSE("2026-03-08 00:00:00"), "YYYY-MM-DD HH:mm")',
          {},
          zone
        ),
      },
      { filter: onlyAlpha }
    );
    expect((await service.execute(context, definition))._unsafeUnwrap().rows).toEqual([
      {
        id: 'recA',
        day: '2026-03-07T12:00',
        week: true,
        month: 3,
        localHour: 12,
        localDate: '2026-03-07',
        localMidnight: '2026-03-08 00:00',
      },
    ]);
    // The same instant read in UTC is a separate declared zone, not a session setting.
    const utc = records(
      { utcHour: formula('HOUR({when})', { when: reference(occurredAtId) }, 'Etc/UTC') },
      { filter: onlyAlpha }
    );
    expect((await service.execute(context, utc))._unsafeUnwrap().rows).toEqual([
      { id: 'recA', utcHour: 17 },
    ]);
  });

  it.each(['Pacific/Honolulu', 'Asia/Tokyo'])(
    'formats instants in the declared formula time zone independently of session %s',
    async (sessionZone) => {
      await sql`select set_config('TimeZone', ${sessionZone}, false)`.execute(database.db);
      const date = { type: 'parameter', name: 'date' } as const;
      const timestamp = { type: 'parameter', name: 'timestamp' } as const;
      const definition = records(
        {
          date: formula(
            'DATETIME_FORMAT(DATETIME_PARSE({date}, "YYYY-MM-DD"), "YYYY-MM-DD")',
            { date },
            'UTC'
          ),
          rawDate: formula('{date}', { date }),
          rawTimestamp: formula('{timestamp}', { timestamp }),
          timestamp: formula(
            'DATETIME_FORMAT({timestamp}, "YYYY-MM-DD HH:mm:ss")',
            { timestamp },
            'UTC'
          ),
          coalesced: formula(
            'DATETIME_FORMAT(IF({date}, DATETIME_PARSE({date}, "YYYY-MM-DD"), DATETIME_PARSE({timestamp})), "YYYY-MM-DD HH:mm:ss")',
            { date, timestamp },
            'UTC'
          ),
          branch: formula(
            'DATETIME_FORMAT(IF(1 = 1, DATETIME_PARSE({date}, "YYYY-MM-DD"), DATETIME_PARSE({timestamp})), "YYYY-MM-DD HH:mm:ss")',
            { date, timestamp },
            'UTC'
          ),
          source: formula(
            'DATETIME_FORMAT({occurredAt}, "YYYY-MM-DD HH:mm:ss")',
            { occurredAt: reference(occurredAtId) },
            'UTC'
          ),
        },
        {
          parameters: { date: { type: 'string' }, timestamp: { type: 'string' } },
          filter: {
            conjunction: 'and',
            items: [
              onlyAlpha,
              formula(
                'DATETIME_PARSE({date}, "YYYY-MM-DD") = DATETIME_PARSE("2026-03-08T00:00:00Z")',
                { date },
                'UTC'
              ),
            ],
          },
        }
      );
      expect(
        (
          await service.execute(context, definition, {
            parameters: { date: '2026-03-08', timestamp: '2026-03-08T09:30:00+09:30' },
          })
        )._unsafeUnwrap().rows
      ).toEqual([
        {
          id: 'recA',
          date: '2026-03-08',
          rawDate: '2026-03-08',
          rawTimestamp: '2026-03-08T09:30:00+09:30',
          timestamp: '2026-03-08 00:00:00',
          coalesced: '2026-03-08 00:00:00',
          branch: '2026-03-08 00:00:00',
          source: '2026-03-07 17:00:00',
        },
      ]);
    }
  );

  it.each(['DATETIME_FORMAT', 'HOUR', 'DAY', 'DATETIME_PARSE', 'DATETIME_DIFF'] as const)(
    'uses the domain IANA time-zone validation for %s',
    async (fn) => {
      const withZone = (timeZone: string) =>
        records(
          {
            value: {
              DATETIME_FORMAT: formula(
                'DATETIME_FORMAT({when}, "YYYY-MM-DD HH:mm")',
                { when: reference(occurredAtId) },
                timeZone
              ),
              HOUR: formula('HOUR({when})', { when: reference(occurredAtId) }, timeZone),
              DAY: formula('DAY({when})', { when: reference(occurredAtId) }, timeZone),
              DATETIME_PARSE: formula(
                'DATETIME_FORMAT(DATETIME_PARSE({when}), "YYYY-MM-DD HH:mm")',
                { when: reference(occurredAtId) },
                timeZone
              ),
              DATETIME_DIFF: formula(
                'DATETIME_DIFF(DATETIME_PARSE("2026-03-08T17:00:00Z"), {when}, "day")',
                { when: reference(occurredAtId) },
                timeZone
              ),
            }[fn],
          },
          { filter: onlyAlpha }
        );
      const expected = {
        DATETIME_FORMAT: '2026-03-07 12:00',
        HOUR: 12,
        DAY: 7,
        DATETIME_PARSE: '2026-03-07 12:00',
        DATETIME_DIFF: 1,
      }[fn];
      expect(
        (await service.execute(context, withZone('America/New_York')))._unsafeUnwrap().rows
      ).toEqual([{ id: 'recA', value: expected }]);

      const kyivExpected = {
        DATETIME_FORMAT: '2026-03-07 19:00',
        HOUR: 19,
        DAY: 7,
        DATETIME_PARSE: '2026-03-07 19:00',
        DATETIME_DIFF: 1,
      }[fn];
      expect(
        (await service.execute(context, withZone('Europe/Kyiv')))._unsafeUnwrap().rows
      ).toEqual([{ id: 'recA', value: kyivExpected }]);
      for (const invalidZone of ['Not/A_TimeZone', '+08:00', 'UTC+8']) {
        const failure = await service.execute(context, withZone(invalidZone));
        expect(failure._unsafeUnwrapErr()).toMatchObject({ code: 'data_query.expression_invalid' });
        expect(JSON.stringify(failure._unsafeUnwrapErr())).not.toContain(invalidZone);
      }
    }
  );
  it('binds expression strings as values and keeps them out of public explain metadata', async () => {
    const sentinel = "EXPRESSION_PRIVATE_BIND'); drop table orders; --";
    const defaultSentinel = 'EXPRESSION_PRIVATE_DEFAULT';
    const definition = records(
      {
        value: formula('CONCATENATE(LOWER({email}), ":", {suffix})', {
          email: reference(emailId),
          suffix: { type: 'parameter', name: 'suffix' },
        }),
      },
      {
        parameters: { suffix: { type: 'string', default: defaultSentinel } },
        filter: onlyAlpha,
      }
    );
    const executed = (
      await service.execute(context, definition, {
        parameters: { suffix: sentinel },
      })
    )._unsafeUnwrap();
    expect(executed.rows).toEqual([{ id: 'recA', value: `alpha@example.com:${sentinel}` }]);
    const table = new DefaultTableMapper().toDomain(tableDto)._unsafeUnwrap();
    const explainer = new DataQueryExplainService(
      { findOne: async () => ok(table) },
      new RecordQueryPluginRunner([], new NoopLogger()),
      new PostgresDataQueryExplainer(database.db)
    );
    const explained = (
      await explainer.explain(context, definition, {
        parameters: { suffix: sentinel },
      })
    )._unsafeUnwrap();
    expect(explained.sql).toContain('$1');
    expect(explained.parameters).toMatchObject({
      order: ['suffix'],
      redaction: 'bind-values-hidden',
      definitions: [{ name: 'suffix', type: 'string', nullable: false }],
    });
    expect(explained.parameters.bindCount).toBeGreaterThan(0);
    expect(explained.plan.analyzed).toBe(false);
    expect(explained).not.toHaveProperty('rows');
    const serialized = JSON.stringify(explained);
    expect(serialized).not.toContain(sentinel);
    expect(serialized).not.toContain(defaultSentinel);
    expect(serialized).not.toContain('alpha@example.com');
    expect(
      (await service.execute(context, records({}, { filter: onlyAlpha })))._unsafeUnwrap().rows
    ).toEqual([{ id: 'recA' }]);
  });

  it('keeps constant and parameter failures lazy inside an untaken row-dependent IF branch', async () => {
    const never = '{quantity} < 0';
    const definition = records(
      {
        constantDivision: formula(`IF(${never}, {price} / ({quantity} - {quantity}), 42)`, {
          price: reference(priceId),
          quantity: reference(quantityId),
        }),
        constantCast: formula(`IF(${never}, VALUE({title}), 42)`, {
          title: reference(titleId),
          quantity: reference(quantityId),
        }),
        parameterDivision: formula(`IF(${never}, 1 / {zero}, 42)`, {
          zero: { type: 'parameter', name: 'zero' },
          quantity: reference(quantityId),
        }),
        parameterCast: formula(`IF(${never}, VALUE({badNumber}), 42)`, {
          badNumber: { type: 'parameter', name: 'badNumber' },
          quantity: reference(quantityId),
        }),
      },
      { parameters: { zero: { type: 'number' }, badNumber: { type: 'string' } } }
    );
    expect(
      (
        await service.execute(context, definition, {
          parameters: { zero: 0, badNumber: 'private-untaken-parameter' },
        })
      )._unsafeUnwrap().rows
    ).toEqual([
      {
        id: 'recA',
        constantDivision: 42,
        constantCast: 42,
        parameterDivision: 42,
        parameterCast: 42,
      },
      {
        id: 'recB',
        constantDivision: 42,
        constantCast: 42,
        parameterDivision: 42,
        parameterCast: 42,
      },
      {
        id: 'recC',
        constantDivision: 42,
        constantCast: 42,
        parameterDivision: 42,
        parameterCast: 42,
      },
    ]);
  });

  it.each(['filter', 'order'] as const)(
    'fails closed for a denied field used only in %s rather than selected output',
    async (usage) => {
      const denied = scopedService({ readableFieldIds: new Set([titleId]) });
      const definition = records(
        {},
        usage === 'filter'
          ? {
              filter: formula('{quantity} > 0', { quantity: reference(quantityId) }),
            }
          : { sort: [{ fieldId: quantityId, order: 'asc' }] }
      );
      const result = await denied.execute(context, definition);
      expect(result._unsafeUnwrapErr()).toMatchObject({ code: 'data_query.field_forbidden' });
    }
  );

  it('never returns formula values for rows excluded by the plugin row scope', async () => {
    const table = new DefaultTableMapper().toDomain(tableDto)._unsafeUnwrap();
    const visibleWhen = buildRecordConditionSpec(table, {
      fieldId: titleId,
      operator: 'is',
      value: '2',
    })._unsafeUnwrap();
    for (const [id, title] of [
      ['recA', '2'],
      ['recB', 'private-hidden-cast'],
      ['recC', 'private-hidden-cast'],
    ] as const) {
      await sql`update ${sql.id('public', physicalTable)} set title = ${title} where __id = ${id}`.execute(
        database.db
      );
    }
    const definition = records({
      value: formula('VALUE({title})', { title: reference(titleId) }),
    });
    const scoped = scopedService({ recordSpec: visibleWhen });
    expect((await scoped.execute(context, definition))._unsafeUnwrap().rows).toEqual([
      { id: 'recA', value: 2 },
    ]);
    // Without the scope the same projection reaches those rows and guards their
    // failed numeric conversion to NULL instead of returning the row's text.
    expect((await service.execute(context, definition))._unsafeUnwrap().rows).toEqual([
      { id: 'recA', value: 2 },
      { id: 'recB', value: null },
      { id: 'recC', value: null },
    ]);
  });

  it('evaluates all-blank arithmetic and temporal operands without ambiguous SQL operators', async () => {
    const definition = records(
      {
        add: formula('BLANK() + BLANK()'),
        subtract: formula('BLANK() - BLANK()'),
        multiply: formula('BLANK() * BLANK()'),
        divide: formula('BLANK() / BLANK()'),
        negate: formula('-BLANK()'),
        difference: formula('DATETIME_DIFF(BLANK(), BLANK(), "day")'),
        truncated: formula('DATETIME_FORMAT(BLANK(), "YYYY-MM-DD")'),
        concatenated: formula('CONCATENATE(BLANK(), BLANK())'),
      },
      { filter: onlyAlpha }
    );
    expect((await service.execute(context, definition))._unsafeUnwrap().rows).toEqual([
      {
        id: 'recA',
        // Teable infers BLANK() + BLANK() as text concatenation, unlike -/* on blanks.
        add: '',
        subtract: 0,
        multiply: 0,
        divide: null,
        negate: null,
        difference: null,
        truncated: null,
        concatenated: '',
      },
    ]);
  });
});
