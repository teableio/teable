import {
  ActorId,
  CellValueMultiplicity,
  CellValueType,
  DefaultTableMapper,
  FunctionName,
  NoopLogger,
  RecordQueryPluginRunner,
  getFormulaSourceBudget,
  type ITablePersistenceDTO,
} from '@teable/v2-core';
import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { DataQueryBinding, DataQueryRelationBinding } from './DataQueryBinding';
import { dataQueryCapabilities } from './DataQueryCapabilities';
import {
  DataQueryDefinition,
  bindDataQueryExpressionLegacyFilter,
  dataQueryOptionalParameters,
  dataQueryDefinitionInputSchema,
  guardDataQueryPlainInput,
} from './DataQueryDefinition';
import type {
  DataQueryFormulaExpression,
  DataQueryFormulaReference,
  DataQueryPredicateV3,
} from './DataQueryExpression';
import {
  bindDataQueryFormulaExpression,
  type DataQueryExpressionBindingContext,
} from './DataQueryExpressionBinding';
import { collectDataQuerySourceFieldUsages } from './DataQueryFieldUsage';
import { DataQueryService } from './DataQueryService';

const tableId = `tbl${'a'.repeat(16)}`;
const textId = `fld${'a'.repeat(16)}`;
const numberId = `fld${'b'.repeat(16)}`;
const userId = `fld${'c'.repeat(16)}`;
const linkId = `fld${'d'.repeat(16)}`;
const targetId = `tbl${'b'.repeat(16)}`;
const formula = (
  text: string,
  references: Record<string, DataQueryFormulaReference> = {}
): DataQueryFormulaExpression => ({ type: 'formula', formula: text, references });
const records = (expr: DataQueryFormulaExpression) => ({
  version: 3,
  kind: 'records',
  tableId,
  select: [{ expr, alias: 'result' }],
});
const dto = (): ITablePersistenceDTO => ({
  id: tableId,
  baseId: `bse${'a'.repeat(16)}`,
  name: 'Root',
  dbTableName: 'public.root',
  primaryFieldId: textId,
  fields: [
    { id: textId, name: 'Title', dbFieldName: 'title', type: 'singleLineText' },
    { id: numberId, name: 'Amount', dbFieldName: 'amount', type: 'number' },
    {
      id: userId,
      name: 'Owner',
      dbFieldName: 'owner',
      type: 'user',
      options: { isMultiple: false },
    },
    {
      id: linkId,
      name: 'Parent',
      dbFieldName: 'parent',
      type: 'link',
      options: {
        relationship: 'manyOne',
        foreignTableId: targetId,
        lookupFieldId: textId,
        isOneWay: true,
        fkHostTableName: 'public.root',
        selfKeyName: '__id',
        foreignKeyName: 'fk_parent',
      },
    },
  ],
  views: [{ id: `viw${'a'.repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
});
const mapper = new DefaultTableMapper();
const context: DataQueryExpressionBindingContext = {
  formulaSourceBudget: getFormulaSourceBudget(),
  resolveField: () =>
    ok({
      valueType: CellValueType.number(),
      multiplicity: CellValueMultiplicity.single(),
      nullable: true,
    }),
  resolveSource: () => ok({ nullable: false, cardinality: 'one' }),
};

describe('version 3 canonical expressions', () => {
  it('keeps old grammars strict, v3 extension keys closed, and the removed scalar DSL rejected', () => {
    for (const version of [1, 2])
      expect(DataQueryDefinition.create({ ...records(formula('1')), version }).isErr()).toBe(true);
    expect(DataQueryDefinition.create({ ...records(formula('1')), distinct: true }).isErr()).toBe(
      true
    );
    expect(DataQueryDefinition.create(records(formula(''))).isErr()).toBe(true);
    expect(
      DataQueryDefinition.create(
        records({
          type: 'formula',
          formula: '1',
          references: {},
          injected: true,
        } as unknown as DataQueryFormulaExpression)
      ).isErr()
    ).toBe(true);
    const malformedFormulas: unknown[] = [
      { type: 'formula', formula: 'LOWER({title})' },
      {
        type: 'formula',
        formula: '1',
        references: { '{invalid}': { type: 'system', system: 'id' } },
      },
      { type: 'formula', formula: '1', references: { value: { type: 'literal', value: 'text' } } },
      { type: 'formula', formula: '1', references: {}, timeZone: 1 },
    ];
    for (const expr of malformedFormulas)
      expect(
        dataQueryDefinitionInputSchema.safeParse({
          version: 3,
          kind: 'records',
          tableId,
          select: [{ expr, alias: 'result' }],
        }).success
      ).toBe(false);

    // The former scalar operand DSL is intentionally absent from v3: fields, systems,
    // parameters, literals and computation nodes exist only as formula references.
    const retiredOperands: unknown[] = [
      { type: 'field', fieldId: textId },
      { type: 'system', system: 'id' },
      { type: 'parameter', name: 'amount' },
      { type: 'literal', value: 1 },
      { type: 'literal', value: '2026-01-01', valueType: 'date' },
      { type: 'call', fn: 'LOWER', args: [{ type: 'literal', value: 'A' }] },
      { type: 'case', branches: [] },
      { type: 'option', value: 'x' },
    ];
    for (const expr of retiredOperands)
      expect(
        DataQueryDefinition.create({
          ...records(formula('1')),
          select: [{ expr, alias: 'result' }],
        }).isErr()
      ).toBe(true);

    // Comparison and null-test leaves were DSL-only; comparisons live in formula text.
    for (const filter of [
      {
        left: { type: 'field', fieldId: numberId },
        operator: 'eq',
        right: { type: 'literal', value: 1 },
      },
      { operand: { type: 'field', fieldId: numberId }, operator: 'isNotNull' },
    ])
      expect(
        DataQueryDefinition.create({
          ...records(formula('1')),
          filter,
        }).isErr()
      ).toBe(true);
  });

  it('retains sanitized structural locations for removed expression grammar', () => {
    const canaries = [
      'FORMULA_PRIVATE_CANARY()',
      'PARAMETER_PRIVATE_CANARY',
      'SELECT SQL_PRIVATE_CANARY',
    ];
    const retiredExpressions = [
      { type: 'field', fieldId: textId },
      { type: 'call', fn: canaries[0], args: [{ type: 'literal', value: canaries[1] }] },
      { type: 'case', branches: [], else: { type: 'literal', value: canaries[2] } },
      { type: 'option', value: canaries[1] },
      { type: 'widen', operand: { type: 'literal', value: canaries[1] } },
      { type: 'commonType', operands: [{ type: 'literal', value: canaries[2] }] },
    ];
    const cases: Array<{ definition: unknown; location: string }> = retiredExpressions.map(
      (expr) => ({
        definition: { ...records(formula('1')), select: [{ expr, alias: 'result' }] },
        location: 'select.0.expr',
      })
    );
    for (const filter of [
      { type: 'compare', left: formula(canaries[0]), operator: 'eq', right: canaries[1] },
      { type: 'isNull', operand: formula(canaries[0]) },
    ]) {
      cases.push({
        definition: {
          ...records(formula('1')),
          filter: { conjunction: 'and', items: [formula('TRUE()'), { not: filter }] },
        },
        location: 'filter.items.1.not',
      });
    }
    cases.push(
      {
        definition: {
          version: 3,
          kind: 'aggregate',
          tableId,
          aggregates: [{ expr: formula(canaries[0]), statisticFunc: 'sum', alias: 'result' }],
        },
        location: 'aggregates.0',
      },
      {
        definition: {
          version: 3,
          kind: 'aggregate',
          tableId,
          aggregates: [{ fieldId: numberId, statisticFunc: 'sum', alias: 'result' }],
          groupBy: [{ expr: formula(canaries[0]), alias: 'group' }],
        },
        location: 'groupBy.0',
      },
      { definition: { ...records(formula('1')), distinct: true }, location: 'distinct' }
    );
    for (const { definition, location } of cases) {
      const error = DataQueryDefinition.create(definition)._unsafeUnwrapErr();
      expect(error.code).toBe('data_query.invalid_definition');
      expect(error.message).toBe('Invalid structured query definition');
      expect(error.details?.path).toEqual(
        expect.stringMatching(new RegExp(`^${location}(?:\\.|$)`))
      );
      for (const canary of canaries) expect(JSON.stringify(error)).not.toContain(canary);
    }
  });

  it('redacts dictionary and unknown keys without losing nested grammar locations', () => {
    const privateKey =
      'FORMULA_PRIVATE_CANARY({PARAMETER_PRIVATE_CANARY}); SELECT SQL_PRIVATE_CANARY';
    for (const key of [privateKey, 'filter', 'type']) {
      const cases = [
        {
          definition: records(
            formula('1', { [key]: { type: 'literal', value: privateKey } } as never)
          ),
          location: 'select.0.expr.references.*',
        },
        {
          definition: {
            ...records(formula('1')),
            relations: {
              [key]: {
                linkFieldId: linkId,
                tableId: targetId,
                filter: { not: { type: 'isNull', operand: formula(privateKey) } },
              },
            },
          },
          location: 'relations.*.filter.not',
        },
        {
          definition: {
            ...records(formula('1')),
            parameters: { [key]: { type: 'invalid', default: privateKey } },
          },
          location: 'parameters.*',
        },
        {
          definition: records({ ...formula('1'), [key]: privateKey }),
          location: 'select.0.expr',
        },
      ];
      for (const { definition, location } of cases) {
        const error = DataQueryDefinition.create(definition)._unsafeUnwrapErr();
        expect(error.code).toBe('data_query.invalid_definition');
        expect(error.details?.path).toEqual(expect.stringContaining(location));
        expect(JSON.stringify(error)).not.toContain(privateKey);
      }
    }
  });

  it('preserves legacy error DTOs and unsupported version identity while locating v3 literals', () => {
    for (const version of [1, 2]) {
      const error = DataQueryDefinition.create({
        ...records(formula('1')),
        version,
      })._unsafeUnwrapErr();
      expect(error.code).toBe('data_query.invalid_definition');
      expect(error.message).toBe('Invalid structured query definition');
      expect(error.details).toBeUndefined();
    }
    const literal = DataQueryDefinition.create({
      ...records(formula('1')),
      filter: { fieldId: numberId, operator: 'is', value: { type: 'literal', value: 1 } },
    })._unsafeUnwrapErr();
    expect(literal.code).toBe('data_query.invalid_definition');
    expect(literal.details?.path).toEqual(expect.stringContaining('filter.value'));
    expect(
      DataQueryDefinition.create({ ...records(formula('1')), version: 999 })._unsafeUnwrapErr().code
    ).toBe('data_query.unsupported_version');
  });

  it('bounds every expression/predicate branch before recursive parsing and never reads accessors', () => {
    const references = Object.fromEntries(
      Array.from({ length: 127 }, (_, index) => [
        `ref${index}`,
        { type: 'field' as const, fieldId: numberId },
      ])
    );
    const expr = formula('1', references);
    expect(DataQueryDefinition.create(records(expr)).isOk()).toBe(true);
    const overBudget = formula('1', { ...references, extra: { type: 'field', fieldId: numberId } });
    expect(DataQueryDefinition.create(records(overBudget))._unsafeUnwrapErr().code).toBe(
      'data_query.expression_too_complex'
    );
    let predicate: DataQueryPredicateV3 = formula('1 = 1');
    for (let depth = 0; depth < 15; depth++) predicate = { not: predicate };
    expect(DataQueryDefinition.create({ ...records(formula('1')), filter: predicate }).isOk()).toBe(
      true
    );
    expect(
      DataQueryDefinition.create({
        ...records(formula('1')),
        filter: { not: predicate },
      })._unsafeUnwrapErr().code
    ).toBe('data_query.expression_too_complex');
    expect(
      DataQueryDefinition.create({
        ...records(formula('1')),
        select: Array.from({ length: 129 }, (_, index) => ({
          expr: formula('1'),
          alias: `a${index}`,
        })),
      })._unsafeUnwrapErr().code
    ).toBe('data_query.expression_too_complex');
    let accessed = false;
    const dangerous = Object.defineProperty({}, 'type', {
      enumerable: true,
      get: () => {
        accessed = true;
        return 'literal';
      },
    });
    expect(
      DataQueryDefinition.create({
        ...records(formula('1')),
        select: [{ expr: dangerous, alias: 'result' }],
      }).isErr()
    ).toBe(true);
    expect(accessed).toBe(false);
    expect(
      DataQueryDefinition.create({ ...records(formula('1')), select: new Array(10001) }).isErr()
    ).toBe(true);
    expect(dataQueryDefinitionInputSchema.safeParse(records(overBudget)).success).toBe(false);
    expect(
      dataQueryDefinitionInputSchema.safeParse({
        ...records(formula('1')),
        select: [{ expr: dangerous, alias: 'result' }],
      }).success
    ).toBe(false);
    expect(accessed).toBe(false);
  });

  it('guards complete public envelopes and skips only validated own definition data in deferred envelopes', () => {
    const shape = z
      .object({ definition: z.unknown(), parameters: z.unknown().optional() })
      .strict();
    const full = guardDataQueryPlainInput(shape);
    const deferred = guardDataQueryPlainInput(shape, { deferDefinition: true });
    let getters = 0;
    const nested = Object.defineProperty({}, 'value', {
      enumerable: true,
      get: () => {
        getters++;
        return 1;
      },
    });
    expect(full.safeParse({ definition: nested }).success).toBe(false);
    expect(deferred.safeParse({ definition: nested }).success).toBe(true);
    expect(
      deferred.safeParse({ definition: records(formula('1')), parameters: nested }).success
    ).toBe(false);
    const root = Object.defineProperty({}, 'definition', {
      enumerable: true,
      get: () => {
        getters++;
        return records(formula('1'));
      },
    });
    expect(full.safeParse(root).success).toBe(false);
    expect(deferred.safeParse(root).success).toBe(false);
    expect(getters).toBe(0);
    expect(full.safeParse(Object.create({ definition: records(formula('1')) })).success).toBe(
      false
    );
  });

  it('keeps expression occurrences required, seals actual/default values, and preserves legacy pruning', () => {
    const definition = DataQueryDefinition.create({
      ...records(formula('{amount}', { amount: { type: 'parameter', name: 'amount' } })),
      parameters: { amount: { type: 'number' } },
      filter: {
        fieldId: numberId,
        operator: 'isGreater',
        value: { type: 'parameter', name: 'amount' },
        optional: true,
      },
    })._unsafeUnwrap();
    expect(dataQueryOptionalParameters(definition.snapshot()).has('amount')).toBe(false);
    expect(definition.bind({})._unsafeUnwrapErr().code).toBe('data_query.missing_parameter');
    const bound = definition.bind({ amount: 9 })._unsafeUnwrap();
    expect(bound.expressionParameters).toEqual({ amount: 9 });
    expect(Object.isFrozen(bound.expressionParameters)).toBe(true);
    expect(bound.filter).toBeUndefined();
    expect(
      bindDataQueryExpressionLegacyFilter(
        {
          fieldId: numberId,
          operator: 'isGreater',
          value: { type: 'parameter', name: 'optional' },
          optional: true,
        },
        {}
      )._unsafeUnwrap()
    ).toBeUndefined();
    const nullable = DataQueryDefinition.create({
      ...records(
        formula('IF({value} = BLANK(), 0, {value})', {
          value: { type: 'parameter', name: 'value' },
        })
      ),
      parameters: { value: { type: 'number', nullable: true } },
    })._unsafeUnwrap();
    expect(nullable.bind({ value: null })._unsafeUnwrap().expressionParameters).toEqual({
      value: null,
    });
    let getterReads = 0;
    const accessor = Object.defineProperty({}, 'amount', {
      enumerable: true,
      get: () => {
        getterReads++;
        return 9;
      },
    });
    expect(definition.bind(accessor).isErr()).toBe(true);
    expect(getterReads).toBe(0);
    const caller = { amount: 9 };
    const sealed = definition.bind(caller)._unsafeUnwrap();
    caller.amount = 100;
    expect(sealed.expressionParameters).toEqual({ amount: 9 });
  });

  it('binds complete mixed OR/NOT graphs without putting expression nodes in core filters', () => {
    const table = mapper.toDomain(dto())._unsafeUnwrap();
    const definition = DataQueryDefinition.create({
      ...records(formula('{amount} + 1', { amount: { type: 'field', fieldId: numberId } })),
      filter: {
        not: {
          conjunction: 'or',
          items: [
            { fieldId: numberId, operator: 'isGreater', value: 0 },
            formula('{amount} + 1 >= 3', { amount: { type: 'field', fieldId: numberId } }),
          ],
        },
      },
      sort: [{ alias: 'result', order: 'desc' }],
    })._unsafeUnwrap();
    const binding = DataQueryBinding.prepare(definition, table)._unsafeUnwrap();
    expect(binding.plan).toMatchObject({
      definitionVersion: 3,
      formulaLanguage: 'teable-formula',
      predicate: {
        kind: 'not',
        predicate: {
          kind: 'group',
          conjunction: 'or',
          items: [
            { kind: 'legacy' },
            { kind: 'formula', expression: { kind: 'formula', formula: '{amount} + 1 >= 3' } },
          ],
        },
      },
      projections: [
        {
          kind: 'expression',
          expression: { kind: 'formula', formula: '{amount} + 1' },
        },
      ],
    });
    const [projection] = binding.plan.projections;
    if (projection.kind !== 'expression') throw new Error('Expected an expression projection');
    expect(projection.expression.valueType.toString()).toBe('number');
    expect(projection.expression.multiplicity.toBoolean()).toBe(false);
    expect(projection.expression.nullable).toBe(true);
    expect(binding.plan.filter).toBeUndefined();
    expect(binding.outputs).toEqual([
      {
        alias: 'result',
        wireType: 'numberOrString',
        cellValueType: 'number',
        isMultipleCellValue: false,
        nullable: true,
      },
    ]);
  });

  it('rejects standalone field operands while binding live metadata through formula references', () => {
    const table = mapper.toDomain(dto())._unsafeUnwrap();
    for (const fieldId of [userId, linkId]) {
      expect(DataQueryDefinition.create(records({ type: 'field', fieldId } as never)).isErr()).toBe(
        true
      );
      const definition = DataQueryDefinition.create(
        records(formula('{value}', { value: { type: 'field', fieldId } }))
      )._unsafeUnwrap();
      const binding = DataQueryBinding.prepare(definition, table)._unsafeUnwrap();
      const [projection] = binding.plan.projections;
      if (projection.kind !== 'expression') throw new Error('Expected an expression projection');
      expect(projection.expression.valueType.toString()).toBe('string');
      expect(projection.expression.multiplicity.toBoolean()).toBe(false);
      expect(projection.expression.nullable).toBe(true);
      expect(projection.expression.references.value).toMatchObject({
        kind: 'field',
        source: 'root',
        fieldId,
      });
      expect(binding.outputs).toEqual([
        {
          alias: 'result',
          wireType: 'string',
          cellValueType: 'string',
          isMultipleCellValue: false,
          nullable: true,
        },
      ]);
    }
  });

  it('keeps masked fields and formula results nullable while preserving identity guarantees', () => {
    const stored = dto();
    const table = mapper
      .toDomain({
        ...stored,
        fields: stored.fields.map((field) =>
          field.id === textId ? { ...field, notNull: true } : field
        ),
      })
      ._unsafeUnwrap();
    expect(
      table
        .getField((field) => field.id().toString() === textId)
        ._unsafeUnwrap()
        .notNull()
        .toBoolean()
    ).toBe(true);
    const title: DataQueryFormulaReference = { type: 'field', fieldId: textId };
    const definition = DataQueryDefinition.create({
      version: 3,
      kind: 'records',
      tableId,
      select: [
        { fieldId: textId, alias: 'required' },
        { expr: formula('LOWER({title})', { title }), alias: 'derived' },
        { expr: formula('IF({title}, {title}, "fallback")', { title }), alias: 'fallback' },
        {
          expr: formula('CONCATENATE({title}, "suffix")', { title }),
          alias: 'concatenated',
        },
        { expr: formula('"fixed"'), alias: 'literal' },
        { system: 'id', alias: 'identity' },
      ],
    })._unsafeUnwrap();
    const binding = DataQueryBinding.prepare(definition, table)._unsafeUnwrap();
    expect(binding.outputs.map(({ alias, nullable }) => ({ alias, nullable }))).toEqual([
      { alias: 'required', nullable: true },
      { alias: 'derived', nullable: true },
      { alias: 'fallback', nullable: true },
      { alias: 'concatenated', nullable: true },
      { alias: 'literal', nullable: true },
      { alias: 'identity', nullable: false },
    ]);
  });

  it('authorizes unreachable IF fields before revealing live scalar errors', async () => {
    const table = mapper.toDomain(dto())._unsafeUnwrap();
    const execute = vi.fn(async () => ok({ rows: [] }));
    const service = new DataQueryService(
      { findOne: async () => ok(table) },
      new RecordQueryPluginRunner(
        [
          {
            name: 'deny-user',
            supports: () => true,
            scope: () => ok({ readableFieldIds: new Set([textId, numberId]) }),
          },
        ],
        new NoopLogger()
      ),
      { execute }
    );
    const definition = DataQueryDefinition.create(
      records(
        formula('IF(1 = 2, {denied}, "visible")', {
          denied: { type: 'field', fieldId: userId },
        })
      )
    )._unsafeUnwrap();
    const result = await service.execute(
      { actorId: ActorId.create('reader')._unsafeUnwrap() },
      definition
    );
    expect(result._unsafeUnwrapErr().code).toBe('data_query.field_forbidden');
  });

  it('qualifies to-one projection and source-local relation predicates independently', () => {
    const root = mapper.toDomain(dto())._unsafeUnwrap();
    const target = mapper
      .toDomain({
        ...dto(),
        id: targetId,
        name: 'Parent',
        dbTableName: 'public.parent',
        fields: dto().fields.filter((field) => field.id !== linkId),
      })
      ._unsafeUnwrap();
    const definition = DataQueryDefinition.create({
      ...records(
        formula('CONCATENATE({root}, {parent})', {
          root: { type: 'field', fieldId: textId },
          parent: { type: 'field', source: 'parent', fieldId: textId },
        })
      ),
      relations: {
        parent: {
          tableId: targetId,
          linkFieldId: linkId,
          filter: formula('{amount} > 0', { amount: { type: 'field', fieldId: numberId } }),
        },
      },
    })._unsafeUnwrap();
    const binding = DataQueryRelationBinding.prepare(
      definition,
      root,
      new Map([['parent', target]])
    )._unsafeUnwrap();
    expect(binding.plan.relationPredicates?.[0]).toMatchObject({
      source: 'parent',
      predicate: {
        kind: 'formula',
        expression: { kind: 'formula', formula: '{amount} > 0' },
      },
    });
    expect(binding.plan.relationFilters).toEqual([]);
    const usages = collectDataQuerySourceFieldUsages(definition.snapshot());
    expect(usages.get('root')?.get(textId)).toContain('projection');
    expect(usages.get('parent')?.get(textId)).toContain('projection');
    expect(usages.get('parent')?.get(numberId)).toContain('filter');
    const forbiddenCrossSource = DataQueryDefinition.create({
      ...definition.snapshot(),
      filter: formula('NOT({value} = BLANK())', {
        value: { type: 'field', source: 'parent', fieldId: numberId },
      }),
    })._unsafeUnwrap();
    expect(
      DataQueryRelationBinding.prepare(
        forbiddenCrossSource,
        root,
        new Map([['parent', target]])
      )._unsafeUnwrapErr().code
    ).toBe('data_query.unsupported_expression_source');
  });

  it('admits aggregate source-row expressions but not expression aggregate arguments or grouping', () => {
    const table = mapper.toDomain(dto())._unsafeUnwrap();
    const aggregate = {
      version: 3,
      kind: 'aggregate',
      tableId,
      aggregates: [{ fieldId: numberId, statisticFunc: 'sum', alias: 'total' }],
      filter: {
        conjunction: 'or',
        items: [
          { fieldId: numberId, operator: 'isGreater', value: 0 },
          formula('{amount} + 1 > 10', { amount: { type: 'field', fieldId: numberId } }),
        ],
      },
    };
    const definition = DataQueryDefinition.create(aggregate)._unsafeUnwrap();
    expect(DataQueryBinding.prepare(definition, table)._unsafeUnwrap().plan).toMatchObject({
      kind: 'aggregate',
      predicate: {
        kind: 'group',
        conjunction: 'or',
        items: [{ kind: 'legacy' }, { kind: 'formula' }],
      },
    });
    expect(
      DataQueryDefinition.create({
        ...aggregate,
        groupBy: [{ expr: formula('1'), alias: 'group' }],
      }).isErr()
    ).toBe(true);
    expect(
      DataQueryDefinition.create({
        ...aggregate,
        aggregates: [{ expr: formula('1'), statisticFunc: 'sum', alias: 'total' }],
      }).isErr()
    ).toBe(true);
  });
});

describe('existing FormulaTypeVisitor inference', () => {
  it('admits Teable function families and retains unevaluated conversion formulas', () => {
    const date = 'DATETIME_PARSE("2026-01-02")';
    const timestamp = 'DATETIME_PARSE("2026-01-02T03:04:05Z")';
    const cases: DataQueryFormulaExpression[] = [
      ...['+', '-', '*', '/'].map((operator) => formula(`1 ${operator} 0`)),
      formula('-BLANK()'),
      formula(`IF(${date}, ${date}, ${timestamp})`),
      formula(`IF(${date} = ${timestamp}, BLANK(), ${date})`),
      formula(`DATETIME_FORMAT(${timestamp}, "YYYY-MM-DD")`),
      formula('VALUE("not-a-number")'),
      formula('NOT("yes")'),
      formula('DATETIME_PARSE("not-a-date")'),
      formula('DATETIME_PARSE("not-a-timestamp")'),
      formula(`DATESTR(${timestamp})`),
      formula(`DATETIME_PARSE(DATESTR(${date}))`),
      formula(`DATETIME_FORMAT(${timestamp}, "YYYY-MM")`),
      formula(`WEEKDAY(${timestamp})`),
      formula(`DATE_ADD(${timestamp}, 1, "day")`),
      formula(`DATETIME_DIFF(${timestamp}, ${timestamp}, "hour")`),
      formula('LOWER("A")'),
      formula('UPPER("a")'),
      formula('LEN("😀")'),
      formula('CONCATENATE(BLANK(), BLANK())'),
    ];
    for (const expression of cases)
      expect(
        bindDataQueryFormulaExpression(expression, context).isOk(),
        JSON.stringify(expression)
      ).toBe(true);
    expect(dataQueryCapabilities.scalarExpressions).toMatchObject({
      language: 'teable-formula',
      functions: Object.values(FunctionName),
      referenceTypes: ['field', 'system', 'parameter'],
    });
    expect(dataQueryCapabilities.scalarExpressions.limits).toEqual({ depth: 16, nodes: 128 });
    const concatenated = bindDataQueryFormulaExpression(
      formula('CONCATENATE(BLANK(), BLANK())'),
      context
    )._unsafeUnwrap();
    expect(concatenated.valueType.toString()).toBe('string');
    expect(concatenated.multiplicity.toBoolean()).toBe(false);
    expect(concatenated.nullable).toBe(true);
    const systems = bindDataQueryFormulaExpression(
      formula('IF({created}, {created}, {modified})', {
        created: { type: 'system', system: 'createdTime' },
        modified: { type: 'system', system: 'lastModifiedTime' },
      }),
      context
    )._unsafeUnwrap();
    expect(systems.valueType.toString()).toBe('dateTime');
    expect(systems.references.created.valueType.toString()).toBe('dateTime');
    expect(systems.references.modified.valueType.toString()).toBe('dateTime');
    expect(systems.nullable).toBe(true);
    expect(
      bindDataQueryFormulaExpression(
        formula(`IF(${date} = ${timestamp}, BLANK(), ${date})`),
        context
      )
        ._unsafeUnwrap()
        .valueType.toString()
    ).toBe('dateTime');
  });

  it('rejects invalid functions, arity, syntax, references and zones', () => {
    const invalid: DataQueryFormulaExpression[] = [
      formula('UNKNOWN_FUNCTION(1)'),
      formula('IF(1, 1)'),
      formula('1 +'),
      formula('{undeclared}'),
      formula('{missing}', { missing: { type: 'parameter', name: 'missing' } }),
      {
        type: 'formula',
        formula: 'YEAR({created})',
        references: { created: { type: 'system', system: 'createdTime' } },
        timeZone: '+05:00',
      },
    ];
    for (const expression of invalid)
      expect(bindDataQueryFormulaExpression(expression, context).isErr()).toBe(true);
  });

  it('keeps nullable reference and IF results conservative without losing scalar parameter checks', () => {
    const nullableContext: DataQueryExpressionBindingContext = {
      ...context,
      parameters: {
        present: { type: 'number' },
        maybe: { type: 'number', nullable: true },
        oldDate: { type: 'date' },
        array: { type: 'number[]' },
      },
    };
    const present: DataQueryFormulaReference = { type: 'parameter', name: 'present' };
    const maybe: DataQueryFormulaReference = { type: 'parameter', name: 'maybe' };
    const references = { present, maybe };
    const referenced = bindDataQueryFormulaExpression(
      formula('IF({maybe}, {maybe}, {present})', references),
      nullableContext
    )._unsafeUnwrap();
    expect(referenced.references.present.nullable).toBe(false);
    expect(referenced.references.maybe.nullable).toBe(true);
    expect(referenced.nullable).toBe(true);
    for (const expression of [
      formula('{maybe} + {present}', references),
      formula('IF({maybe}, {present}, BLANK())', references),
      formula('IF({maybe}, {present}, 1)', references),
    ]) {
      expect(
        bindDataQueryFormulaExpression(expression, nullableContext)._unsafeUnwrap().nullable
      ).toBe(true);
    }
    expect(
      bindDataQueryFormulaExpression(
        formula('{oldDate}', { oldDate: { type: 'parameter', name: 'oldDate' } }),
        nullableContext
      )._unsafeUnwrapErr().code
    ).toBe('data_query.unsupported_type');
    expect(
      bindDataQueryFormulaExpression(
        formula('{array}', { array: { type: 'parameter', name: 'array' } }),
        nullableContext
      )._unsafeUnwrapErr().code
    ).toBe('data_query.unsupported_type');
  });
});
