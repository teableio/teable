import { DefaultTableMapper, type ITablePersistenceDTO } from '@teable/v2-core';
import { describe, expect, it } from 'vitest';

import { assertDataQueryAccess, dataQueryAccessForSource } from './assertDataQueryAccess';
import { DataQueryBinding, DataQueryRelationBinding } from './DataQueryBinding';
import { dataQueryCapabilities } from './DataQueryCapabilities';
import { DataQueryDefinition, dataQueryDefinitionInputSchema } from './DataQueryDefinition';
import {
  collectDataQueryManifestDependencies,
  DATA_QUERY_DEPENDENCY_ANALYZER_VERSION,
} from './DataQueryManifestDependencies';
import { parseDataQueryManifestText } from './DataQueryManifestFiles';
import { dataQueryLintCodes, lintDataQueryManifest } from './DataQueryManifestLint';
import { planDataQueryManifestRepair } from './DataQueryManifestRepair';
import { dataQuerySchemaSignature } from './DataQuerySchemaSignature';

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
    expect(DATA_QUERY_DEPENDENCY_ANALYZER_VERSION).toBe(11);
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
});
