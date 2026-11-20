import { DefaultTableMapper, type ITablePersistenceDTO } from '@teable/v2-core';
import { describe, expect, it } from 'vitest';

import { assertDataQueryAccess, dataQueryAccessForSource } from './assertDataQueryAccess';
import { DataQueryBinding, DataQueryRelationBinding } from './DataQueryBinding';
import { dataQueryCapabilities } from './DataQueryCapabilities';
import { DataQueryDefinition, dataQueryDefinitionInputSchema } from './DataQueryDefinition';
import type { DataQueryFormulaExpression } from './DataQueryExpression';
import {
  collectDataQueryManifestDependencies,
  DATA_QUERY_DEPENDENCY_ANALYZER_VERSION,
} from './DataQueryManifestDependencies';
import { generateAppQueryArtifacts, parseDataQueryManifestText } from './DataQueryManifestFiles';
import { dataQueryLintCodes, lintDataQueryManifest } from './DataQueryManifestLint';
import { planDataQueryManifestRepair } from './DataQueryManifestRepair';
import { dataQuerySchemaSignature } from './DataQuerySchemaSignature';
import { executeDataQueryRequestSchema, queryExecutionJsonSchema } from './queryExecutionProtocol';

const tableId = `tbl${'a'.repeat(16)}`;
const targetId = `tbl${'b'.repeat(16)}`;
const titleId = `fld${'a'.repeat(16)}`;
const amountId = `fld${'b'.repeat(16)}`;
const linkId = `fld${'c'.repeat(16)}`;
const mapper = new DefaultTableMapper();
const dto = (): ITablePersistenceDTO => ({
  id: tableId,
  baseId: `bse${'a'.repeat(16)}`,
  name: 'Distinct',
  dbTableName: 'public.distinct_root',
  primaryFieldId: titleId,
  fields: [
    { id: titleId, name: 'Title', type: 'singleLineText', dbFieldName: 'title' },
    { id: amountId, name: 'Amount', type: 'number', dbFieldName: 'amount' },
    {
      id: linkId,
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
const records = (extra: Record<string, unknown> = {}) => ({
  version: 6,
  kind: 'records',
  tableId,
  distinct: true,
  select: [{ fieldId: titleId, alias: 'title' }],
  ...extra,
});
const manifest = (definition: unknown) =>
  parseDataQueryManifestText(
    JSON.stringify({ schemaVersion: 1, queries: { unique: { definition } } })
  )._unsafeUnwrap();
const key = (fieldId: string, source?: string): DataQueryFormulaExpression => ({
  type: 'formula',
  formula: '{value}',
  references: { value: { type: 'field', fieldId, ...(source ? { source } : {}) } },
});
const tupleAggregate = (extra: Record<string, unknown> = {}) => ({
  version: 8,
  kind: 'aggregate',
  tableId,
  aggregates: [
    { statisticFunc: 'unique', distinctBy: [key(titleId), key(amountId)], alias: 'pairs' },
  ],
  ...extra,
});

describe('V9 Top-N binding', () => {
  it('binds ranking aliases to projected field dependencies and checks read access', () => {
    const input = {
      version: 9,
      kind: 'records',
      tableId,
      select: [
        { fieldId: titleId, alias: 'team' },
        { fieldId: amountId, alias: 'score' },
      ],
      topN: { partitionBy: ['team'], orderBy: [{ alias: 'score', order: 'desc' }], limit: 2 },
    };
    const table = mapper.toDomain(dto())._unsafeUnwrap();
    const definition = DataQueryDefinition.create(input)._unsafeUnwrap();
    const binding = DataQueryBinding.prepare(definition, table)._unsafeUnwrap();
    expect(binding.plan.topN).toEqual(input.topN);
    expect(binding.plan.usage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'root',
          fieldId: titleId,
          usages: expect.arrayContaining(['projection']),
        }),
        expect.objectContaining({
          source: 'root',
          fieldId: amountId,
          usages: expect.arrayContaining(['projection']),
        }),
      ])
    );
    expect(
      assertDataQueryAccess(dataQueryAccessForSource(binding.plan, 'root'), {
        readableFieldIds: new Set([titleId]),
      }).isErr()
    ).toBe(true);
    expect(
      assertDataQueryAccess(dataQueryAccessForSource(binding.plan, 'root'), {
        readableFieldIds: new Set([titleId, amountId]),
      }).isOk()
    ).toBe(true);
  });
});

describe('V6 records DISTINCT canonical contract', () => {
  it('admits only the opt-in true flag in V6 records and leaves every historical schema strict', () => {
    expect(DataQueryDefinition.create(records()).isOk()).toBe(true);
    for (const version of [1, 2, 3, 4, 5])
      expect(dataQueryDefinitionInputSchema.safeParse(records({ version })).success).toBe(false);
    for (const distinct of [false, 'true', 1, null])
      expect(DataQueryDefinition.create(records({ distinct })).isErr()).toBe(true);
    expect(
      DataQueryDefinition.create({
        version: 6,
        kind: 'aggregate',
        tableId,
        distinct: true,
        aggregates: [{ fieldId: amountId, statisticFunc: 'sum', alias: 'total' }],
      }).isErr()
    ).toBe(true);
    expect(DataQueryDefinition.create(records({ version: 999 })).isErr()).toBe(true);
    expect(dataQueryCapabilities.definitionVersions).toContain(6);
    expect(DATA_QUERY_DEPENDENCY_ANALYZER_VERSION).toBe(13);
  });

  it('binds literal and parameter targets to selected aliases and validates absent optional allow-lists', () => {
    const definition = DataQueryDefinition.create(
      records({
        parameters: { by: { type: 'string' }, direction: { type: 'string' } },
        select: [
          { fieldId: titleId, alias: 'caption' },
          { system: 'id', alias: 'identity' },
        ],
        sort: [
          {
            field: { type: 'parameter', name: 'by' },
            order: { type: 'parameter', name: 'direction' },
            allowed: [{ fieldId: titleId }, { system: 'id' }],
            optional: true,
          },
        ],
      })
    )._unsafeUnwrap();
    expect(definition.bind({})._unsafeUnwrap().sort).toEqual([]);
    expect(definition.bind({ by: titleId, direction: 'desc' })._unsafeUnwrap().sort).toEqual([
      { alias: 'caption', order: 'desc' },
    ]);
    expect(definition.bind({ by: 'id', direction: 'asc' })._unsafeUnwrap().sort).toEqual([
      { alias: 'identity', order: 'asc' },
    ]);
    expect(definition.bind({ by: amountId, direction: 'asc' }).isErr()).toBe(true);
    expect(
      DataQueryDefinition.create(records({ sort: [{ fieldId: titleId, order: 'asc' }] }))
        ._unsafeUnwrap()
        .bind({})
        ._unsafeUnwrap().sort
    ).toEqual([{ alias: 'title', order: 'asc' }]);
    for (const select of [
      [{ fieldId: amountId, alias: 'amount' }],
      [
        { fieldId: titleId, alias: 'first' },
        { fieldId: titleId, alias: 'second' },
      ],
      [{ fieldId: titleId, alias: 'tags', arrayDistinct: true }],
      [
        {
          fieldId: titleId,
          alias: 'bucket',
          bucket: {
            kind: 'numericRange',
            edges: [{ maxExclusive: 1, label: 'low' }],
            fallbackLabel: 'high',
          },
        },
      ],
    ]) {
      expect(
        DataQueryDefinition.create(
          records({
            select,
            parameters: { by: { type: 'string' } },
            sort: [
              {
                field: { type: 'parameter', name: 'by' },
                order: 'asc',
                allowed: [{ fieldId: titleId }],
                optional: true,
              },
            ],
          })
        ).isErr()
      ).toBe(true);
      expect(
        DataQueryDefinition.create(
          records({ select, sort: [{ alias: select[0]!.alias, order: 'asc' }] })
        ).isOk()
      ).toBe(true);
    }
  });

  it('carries explicit tuple grain and fingerprints it without changing ordinary V6 outputs', async () => {
    const table = mapper.toDomain(dto())._unsafeUnwrap();
    const unique = DataQueryBinding.prepare(
      DataQueryDefinition.create(records())._unsafeUnwrap(),
      table
    )._unsafeUnwrap();
    const ordinary = DataQueryBinding.prepare(
      DataQueryDefinition.create(records({ distinct: undefined }))._unsafeUnwrap(),
      table
    )._unsafeUnwrap();
    expect(unique.plan.resultGrain).toBe('distinctTuple');
    expect(ordinary.plan.resultGrain).toBe('record');
    expect(unique.outputs).toEqual(ordinary.outputs);
    const tables = new Map([['root', table]]);
    expect(
      (await dataQuerySchemaSignature(unique.plan, tables, unique.outputs))._unsafeUnwrap()
    ).not.toBe(
      (await dataQuerySchemaSignature(ordinary.plan, tables, ordinary.outputs))._unsafeUnwrap()
    );
    const text = JSON.stringify({
      schemaVersion: 1,
      queries: {
        unique: { definition: records() },
        ordinary: { definition: records({ distinct: undefined }) },
      },
    });
    const parsed = parseDataQueryManifestText(text)._unsafeUnwrap();
    expect(
      lintDataQueryManifest({ text, manifest: parsed }).some(
        (finding) => finding.code === dataQueryLintCodes.duplicateDefinition
      )
    ).toBe(false);
  });

  it('inherits V5 existence authorization and V4 aggregate filters/HAVING', () => {
    const root = mapper.toDomain(dto())._unsafeUnwrap();
    const target = mapper
      .toDomain({
        ...dto(),
        id: targetId,
        dbTableName: 'public.distinct_target',
        fields: dto().fields.slice(0, 2),
      })
      ._unsafeUnwrap();
    for (const quantifier of ['any', 'none']) {
      const input = records({
        relations: { items: { linkFieldId: linkId, tableId: targetId } },
        filter: { relation: 'items', quantifier },
      });
      const definition = DataQueryDefinition.create(input)._unsafeUnwrap();
      const binding = DataQueryRelationBinding.prepare(
        definition,
        root,
        new Map([['items', target]])
      )._unsafeUnwrap();
      const access = dataQueryAccessForSource(binding.plan, 'root');
      expect(assertDataQueryAccess(access, { readableFieldIds: new Set([titleId]) }).isErr()).toBe(
        true
      );
      expect(binding.plan.predicate).toMatchObject({ kind: 'exists', quantifier });
    }
    expect(
      DataQueryDefinition.create({
        version: 6,
        kind: 'aggregate',
        tableId,
        parameters: { minimum: { type: 'number' } },
        aggregates: [
          {
            fieldId: amountId,
            statisticFunc: 'sum',
            alias: 'total',
            filter: { fieldId: amountId, operator: 'isGreater', value: 0 },
          },
        ],
        having: {
          type: 'formula',
          formula: '{total} > {minimum}',
          references: {
            total: { type: 'output', alias: 'total' },
            minimum: { type: 'parameter', name: 'minimum' },
          },
        },
      }).isOk()
    ).toBe(true);
  });

  it('requires manual repair for grain deletion/replacement/formula references but preserves renames', () => {
    for (const select of [
      [{ fieldId: titleId, alias: 'title' }],
      [
        {
          alias: 'caption',
          expr: {
            type: 'formula',
            formula: 'LOWER({title})',
            references: { title: { type: 'field', fieldId: titleId } },
          },
        },
      ],
    ]) {
      const accepted = manifest(records({ select }));
      const dependencies = collectDataQueryManifestDependencies(accepted).queries;
      for (const change of [
        { kind: 'field_deleted' as const, tableId, fieldId: titleId },
        {
          kind: 'field_replaced' as const,
          tableId,
          fieldId: titleId,
          replacementFieldId: amountId,
          outputCompatible: true,
        },
        {
          kind: 'field_updated' as const,
          tableId,
          fieldId: titleId,
          typeChanged: true,
          outputCompatible: true,
        },
      ]) {
        const repair = planDataQueryManifestRepair(accepted, change, dependencies);
        expect(repair.queries[0]?.classification).toBe('manual');
        expect(repair.queries[0]?.actions).toEqual([]);
        expect(repair.repaired).toBeUndefined();
      }
      expect(
        planDataQueryManifestRepair(
          accepted,
          {
            kind: 'field_updated',
            tableId,
            fieldId: titleId,
            previousName: 'old',
            fieldName: 'new',
          },
          dependencies
        ).queries[0]?.classification
      ).toBe('noop');
    }
  });

  it('binds V8 tuple distinct keys and retains V6 records distinct semantics', () => {
    const table = mapper.toDomain(dto())._unsafeUnwrap();
    const definition = DataQueryDefinition.create({
      version: 8,
      kind: 'aggregate',
      tableId,
      aggregates: [
        {
          statisticFunc: 'unique',
          distinctBy: [
            {
              type: 'formula',
              formula: '{title}',
              references: { title: { type: 'field', fieldId: titleId } },
            },
            {
              type: 'formula',
              formula: '{amount}',
              references: { amount: { type: 'field', fieldId: amountId } },
            },
          ],
          alias: 'pairs',
        },
      ],
    })._unsafeUnwrap();
    const binding = DataQueryBinding.prepare(definition, table)._unsafeUnwrap();
    expect(binding.plan.aggregates[0]).toMatchObject({
      statisticFunc: 'unique',
      source: 'root',
      alias: 'pairs',
      distinctExpressions: [{ kind: 'formula' }, { kind: 'formula' }],
    });
    expect(binding.outputs).toMatchObject([
      { alias: 'pairs', cellValueType: 'number', nullable: false },
    ]);
    expect(DataQueryDefinition.create(records({ version: 8 })).isOk()).toBe(true);
    expect(
      DataQueryDefinition.create(
        records({
          version: 7,
          parameters: { cursor: { type: 'string' } },
          page: { limit: 2, after: { type: 'parameter', name: 'cursor' } },
        })
      ).isOk()
    ).toBe(true);
  });

  it('rejects mixed tuple metrics, invalid arity and old versions without widening scalar unique', () => {
    const metric = { statisticFunc: 'unique', distinctBy: [key(titleId)], alias: 'pairs' };
    for (const invalid of [
      { ...metric, distinctBy: [] },
      { ...metric, distinctBy: Array.from({ length: 9 }, () => key(titleId)) },
      { ...metric, fieldId: titleId },
      { ...metric, expr: key(titleId) },
      { ...metric, statisticFunc: 'count' },
    ])
      expect(DataQueryDefinition.create(tupleAggregate({ aggregates: [invalid] })).isErr()).toBe(
        true
      );
    for (const version of [1, 2, 3, 4, 5, 6, 7]) {
      expect(DataQueryDefinition.create(tupleAggregate({ version })).isErr()).toBe(true);
      if (version === 7) continue;
      for (const input of [{ fieldId: titleId }, { expr: key(titleId) }]) {
        expect(
          DataQueryDefinition.create(
            tupleAggregate({
              version,
              relations: { items: { linkFieldId: linkId, tableId: targetId } },
              aggregates: [{ source: 'items', statisticFunc: 'unique', alias: 'pairs', ...input }],
            })
          ).isErr()
        ).toBe(true);
      }
    }
    expect(
      DataQueryDefinition.create(
        tupleAggregate({
          aggregates: [
            {
              statisticFunc: 'unique',
              distinctBy: Array.from({ length: 8 }, () => key(titleId)),
              alias: 'pairs',
            },
          ],
        })
      ).isOk()
    ).toBe(true);
    // The structural budget covers every declared key reference, including unused bindings.
    expect(
      DataQueryDefinition.create(
        tupleAggregate({
          aggregates: [
            {
              ...metric,
              distinctBy: Array.from({ length: 8 }, () => ({
                type: 'formula',
                formula: '1',
                references: Object.fromEntries(
                  Array.from({ length: 20 }, (_, index) => [
                    `f${index}`,
                    { type: 'field', fieldId: titleId },
                  ])
                ),
              })),
            },
          ],
        })
      ).isErr()
    ).toBe(true);
  });

  it('authorizes every tuple operand, including unused references, and records offline dependencies', () => {
    const table = mapper.toDomain(dto())._unsafeUnwrap();
    const input = tupleAggregate({
      aggregates: [
        {
          statisticFunc: 'unique',
          alias: 'pairs',
          distinctBy: [
            key(titleId),
            {
              type: 'formula',
              formula: '1',
              references: { hidden: { type: 'field', fieldId: amountId } },
            },
          ],
        },
      ],
    });
    const binding = DataQueryBinding.prepare(
      DataQueryDefinition.create(input)._unsafeUnwrap(),
      table
    )._unsafeUnwrap();
    expect(binding.plan.usage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'root',
          fieldId: titleId,
          usages: ['aggregate', 'reference'],
        }),
        expect.objectContaining({
          source: 'root',
          fieldId: amountId,
          usages: ['aggregate', 'reference'],
        }),
      ])
    );
    const access = dataQueryAccessForSource(binding.plan, 'root');
    for (const readableFieldIds of [new Set([titleId]), new Set([amountId])])
      expect(assertDataQueryAccess(access, { readableFieldIds }).isErr()).toBe(true);
    const dependencies = collectDataQueryManifestDependencies(manifest(input));
    expect(JSON.stringify(dependencies)).toContain(amountId);
    expect(JSON.stringify(dependencies)).toContain(titleId);
  });

  it('binds tuple parameters and source-local relation operands while rejecting missing or many-valued root sources', () => {
    const root = mapper.toDomain(dto())._unsafeUnwrap();
    const target = mapper
      .toDomain({
        ...dto(),
        id: targetId,
        dbTableName: 'public.distinct_target',
        fields: dto().fields.slice(0, 2),
      })
      ._unsafeUnwrap();
    const relations = { items: { linkFieldId: linkId, tableId: targetId } };
    const parameter = {
      type: 'formula',
      formula: '{minimum}',
      references: { minimum: { type: 'parameter', name: 'minimum' } },
    };
    const input = tupleAggregate({
      relations,
      parameters: { minimum: { type: 'number' } },
      aggregates: [
        {
          source: 'items',
          statisticFunc: 'unique',
          distinctBy: [key(titleId), parameter],
          alias: 'pairs',
          filter: {
            type: 'formula',
            formula: '{value} > {minimum}',
            references: {
              value: { type: 'field', fieldId: amountId },
              minimum: { type: 'parameter', name: 'minimum' },
            },
          },
        },
      ],
    });
    const definition = DataQueryDefinition.create(input)._unsafeUnwrap();
    expect(definition.bind({}).isErr()).toBe(true);
    expect(definition.bind({ minimum: 2 }).isOk()).toBe(true);
    const bound = DataQueryRelationBinding.prepare(
      definition,
      root,
      new Map([['items', target]])
    )._unsafeUnwrap();
    expect(bound.plan.aggregates[0]).toMatchObject({
      source: 'items',
      distinctExpressions: [
        { recordSource: 'items', references: { value: { source: 'items' } } },
        { recordSource: 'items', references: { minimum: { kind: 'parameter', name: 'minimum' } } },
      ],
      filter: { kind: 'formula' },
    });
    for (const metric of [
      { source: 'items', distinctBy: [key(titleId, 'root')] },
      { distinctBy: [key(titleId, 'items')] },
    ]) {
      const invalid = DataQueryDefinition.create(
        tupleAggregate({
          relations,
          aggregates: [{ statisticFunc: 'unique', alias: 'pairs', ...metric }],
        })
      )._unsafeUnwrap();
      expect(
        DataQueryRelationBinding.prepare(invalid, root, new Map([['items', target]])).isErr()
      ).toBe(true);
    }
    expect(
      DataQueryDefinition.create(
        tupleAggregate({
          aggregates: [
            {
              source: 'missing',
              statisticFunc: 'unique',
              alias: 'pairs',
              distinctBy: [{ type: 'formula', formula: '1', references: {} }],
            },
          ],
        })
      ).isErr()
    ).toBe(true);
    expect(DataQueryRelationBinding.prepare(definition, root, new Map()).isErr()).toBe(true);
    for (const metric of [{ fieldId: titleId }, { expr: key(titleId) }]) {
      const scalar = DataQueryDefinition.create(
        tupleAggregate({
          relations,
          aggregates: [{ source: 'items', statisticFunc: 'unique', alias: 'pairs', ...metric }],
        })
      )._unsafeUnwrap();
      expect(
        DataQueryRelationBinding.prepare(scalar, root, new Map([['items', target]]))._unsafeUnwrap()
          .outputs[0]
      ).toMatchObject({ nullable: false, cellValueType: 'number' });
    }
  });

  it('accepts root keys from to-one sources and rejects sibling inputs in relation metric filters', () => {
    const rootDto = dto();
    const oneLinkId = `fld${'d'.repeat(16)}`;
    const root = mapper
      .toDomain({
        ...rootDto,
        fields: [
          ...rootDto.fields,
          {
            id: oneLinkId,
            name: 'Owner',
            type: 'link',
            dbFieldName: 'owner',
            options: {
              relationship: 'manyOne',
              foreignTableId: targetId,
              lookupFieldId: titleId,
              isOneWay: false,
              fkHostTableName: 'public.distinct_root',
              selfKeyName: '__id',
              foreignKeyName: 'fk_owner',
            },
          },
        ],
      })
      ._unsafeUnwrap();
    const target = mapper
      .toDomain({
        ...dto(),
        id: targetId,
        dbTableName: 'public.distinct_target',
        fields: dto().fields.slice(0, 2),
      })
      ._unsafeUnwrap();
    const relations = {
      items: { linkFieldId: linkId, tableId: targetId },
      owner: { linkFieldId: oneLinkId, tableId: targetId },
    };
    const tables = new Map([
      ['items', target],
      ['owner', target],
    ]);
    const definition = DataQueryDefinition.create(
      tupleAggregate({
        relations,
        aggregates: [
          {
            statisticFunc: 'unique',
            alias: 'pairs',
            distinctBy: [key(titleId), key(amountId, 'owner')],
          },
        ],
      })
    )._unsafeUnwrap();
    const bound = DataQueryRelationBinding.prepare(definition, root, tables)._unsafeUnwrap();
    expect(bound.plan.aggregates[0].distinctExpressions?.[1].references.value).toMatchObject({
      kind: 'field',
      source: 'owner',
      fieldId: amountId,
    });
    const invalid = DataQueryDefinition.create(
      tupleAggregate({
        relations,
        aggregates: [
          {
            source: 'items',
            statisticFunc: 'unique',
            alias: 'pairs',
            distinctBy: [key(titleId)],
            filter: {
              type: 'formula',
              formula: '{value} > 0',
              references: { value: { type: 'field', source: 'owner', fieldId: amountId } },
            },
          },
        ],
      })
    )._unsafeUnwrap();
    expect(DataQueryRelationBinding.prepare(invalid, root, tables).isErr()).toBe(true);
  });

  it('retains records tuple grain, selected-output sorting and aggregate HAVING in V8', () => {
    const table = mapper.toDomain(dto())._unsafeUnwrap();
    const recordsDefinition = DataQueryDefinition.create(
      records({ version: 8, sort: [{ fieldId: titleId, order: 'asc' }] })
    )._unsafeUnwrap();
    expect(recordsDefinition.bind({})._unsafeUnwrap().sort).toEqual([
      { alias: 'title', order: 'asc' },
    ]);
    expect(
      DataQueryBinding.prepare(recordsDefinition, table)._unsafeUnwrap().plan.resultGrain
    ).toBe('distinctTuple');
    expect(
      DataQueryDefinition.create(
        records({ version: 8, sort: [{ fieldId: amountId, order: 'asc' }] })
      ).isErr()
    ).toBe(true);
    const definition = DataQueryDefinition.create(
      tupleAggregate({
        groupBy: [{ fieldId: titleId, alias: 'title' }],
        parameters: { minimum: { type: 'number' } },
        having: {
          type: 'formula',
          formula: '{pairs} > {minimum}',
          references: {
            pairs: { type: 'output', alias: 'pairs' },
            minimum: { type: 'parameter', name: 'minimum' },
          },
        },
      })
    )._unsafeUnwrap();
    const bound = DataQueryBinding.prepare(definition, table)._unsafeUnwrap();
    expect(bound.plan).toMatchObject({
      resultGrain: 'group',
      having: { kind: 'formula', references: { pairs: { kind: 'output', alias: 'pairs' } } },
    });
    expect(bound.outputs.map((output) => output.alias)).toEqual(['title', 'pairs']);
  });

  it('publishes V8 through native schemas, capabilities and generated client output contracts', () => {
    const input = tupleAggregate({
      parameters: { minimum: { type: 'number' } },
      aggregates: [
        {
          statisticFunc: 'unique',
          alias: 'pairs',
          distinctBy: [
            {
              type: 'formula',
              formula: '{minimum}',
              references: { minimum: { type: 'parameter', name: 'minimum' } },
            },
          ],
        },
      ],
    });
    expect(executeDataQueryRequestSchema.safeParse({ definition: input }).success).toBe(true);
    expect(JSON.stringify(queryExecutionJsonSchema())).toContain('distinctBy');
    expect(dataQueryCapabilities.definitionVersions).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(dataQueryCapabilities.distinctAggregate).toMatchObject({
      version: 8,
      grain: 'outputGroup',
      maxKeys: 8,
      emptyInput: 0,
      missingRelationInput: 0,
    });
    const table = mapper.toDomain(dto())._unsafeUnwrap();
    const bound = DataQueryBinding.prepare(
      DataQueryDefinition.create(input)._unsafeUnwrap(),
      table
    )._unsafeUnwrap();
    const generated = generateAppQueryArtifacts(manifest(input), {
      unique: { outputs: bound.outputs },
    })._unsafeUnwrap();
    expect(generated.module).toContain('"pairs": number | string');
    expect(generated.module).toContain('"minimum": number');
    expect(generateAppQueryArtifacts(manifest(input))._unsafeUnwrap().module).toContain(
      '"pairs": number | string'
    );
    expect(generated.schema).toContain('distinctBy');
  });

  it('preserves tuple grain in schema signatures, linting and schema-change repair', async () => {
    const table = mapper.toDomain(dto())._unsafeUnwrap();
    const input = tupleAggregate();
    const reordered = tupleAggregate({
      aggregates: [
        { statisticFunc: 'unique', distinctBy: [key(amountId), key(titleId)], alias: 'pairs' },
      ],
    });
    const bindings = [input, reordered].map((value) =>
      DataQueryBinding.prepare(
        DataQueryDefinition.create(value)._unsafeUnwrap(),
        table
      )._unsafeUnwrap()
    );
    const signatures = await Promise.all(
      bindings.map((binding) =>
        dataQuerySchemaSignature(binding.plan, new Map([['root', table]]), binding.outputs)
      )
    );
    expect(signatures[0]._unsafeUnwrap()).not.toBe(signatures[1]._unsafeUnwrap());
    const text = JSON.stringify({
      schemaVersion: 1,
      queries: { first: { definition: input }, second: { definition: reordered } },
    });
    expect(
      lintDataQueryManifest({
        text,
        manifest: parseDataQueryManifestText(text)._unsafeUnwrap(),
      }).some((finding) => finding.code === dataQueryLintCodes.duplicateDefinition)
    ).toBe(false);
    const accepted = manifest(input);
    const dependencies = collectDataQueryManifestDependencies(accepted).queries;
    for (const fieldId of [titleId, amountId])
      for (const change of [
        { kind: 'field_deleted' as const, tableId, fieldId },
        {
          kind: 'field_replaced' as const,
          tableId,
          fieldId,
          replacementFieldId: linkId,
          outputCompatible: true,
        },
        {
          kind: 'field_updated' as const,
          tableId,
          fieldId,
          typeChanged: true,
          outputCompatible: true,
        },
      ])
        expect(
          planDataQueryManifestRepair(accepted, change, dependencies).queries[0]?.classification
        ).toBe('manual');
  });
});
