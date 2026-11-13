import {
  ActorId,
  buildRecordConditionSpec,
  DefaultTableMapper,
  NoopLogger,
  RecordQueryPluginRunner,
  type ITablePersistenceDTO,
} from '@teable/v2-core';
import { ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { assertDataQueryAccess, dataQueryAccessForSource } from './assertDataQueryAccess';
import { DataQueryRelationBinding } from './DataQueryBinding';
import { DataQueryDefinition, dataQueryOptionalParameters } from './DataQueryDefinition';
import { dataQuerySchemaSignature } from './DataQuerySchemaSignature';
import { authorizeDataQueryExpressionDependencies } from './DataQueryService';
import type { DataQueryDefinitionV5Input } from './types';

const rootTableId = `tbl${'a'.repeat(16)}`;
const targetTableId = `tbl${'b'.repeat(16)}`;
const departmentTableId = `tbl${'c'.repeat(16)}`;
const baseId = `bse${'a'.repeat(16)}`;

const titleId = `fld${'a'.repeat(16)}`;
const ownerId = `fld${'b'.repeat(16)}`;
const itemsId = `fld${'c'.repeat(16)}`;
const tagsId = `fld${'d'.repeat(16)}`;
const notesId = `fld${'e'.repeat(16)}`;
const dueId = `fld${'f'.repeat(16)}`;
const targetNameId = `fld${'g'.repeat(16)}`;
const amountId = `fld${'h'.repeat(16)}`;
const targetDueId = `fld${'i'.repeat(16)}`;
const departmentLinkId = `fld${'j'.repeat(16)}`;
const departmentNameId = `fld${'k'.repeat(16)}`;
const rootPhysical = 'public.relation_root';
const targetPhysical = 'public.relation_target';
const departmentPhysical = 'public.relation_department';
const junctionTags = 'public.junction_tags';
const junctionNotes = 'public.junction_notes';

const mapper = new DefaultTableMapper();

const rootDto = (): ITablePersistenceDTO => ({
  id: rootTableId,
  baseId,
  name: 'Root',
  dbTableName: rootPhysical,
  primaryFieldId: titleId,
  fields: [
    { id: titleId, name: 'Title', dbFieldName: 'title', type: 'singleLineText' },
    { id: dueId, name: 'Due', dbFieldName: 'due', type: 'date' },
    {
      id: ownerId,
      name: 'Owner',
      dbFieldName: 'owner',
      type: 'link',
      options: {
        relationship: 'manyOne',
        foreignTableId: targetTableId,
        lookupFieldId: targetNameId,
        isOneWay: true,
        fkHostTableName: rootPhysical,
        selfKeyName: '__id',
        foreignKeyName: 'fk_owner',
      },
    },
    {
      id: itemsId,
      name: 'Items',
      dbFieldName: 'items',
      type: 'link',
      options: {
        relationship: 'oneMany',
        foreignTableId: targetTableId,
        lookupFieldId: targetNameId,
        isOneWay: false,
        fkHostTableName: targetPhysical,
        selfKeyName: 'fk_items',
        foreignKeyName: '__id',
      },
    },
    {
      id: tagsId,
      name: 'Tags',
      dbFieldName: 'tags',
      type: 'link',
      options: {
        relationship: 'manyMany',
        foreignTableId: targetTableId,
        lookupFieldId: targetNameId,
        isOneWay: false,
        fkHostTableName: junctionTags,
        selfKeyName: '__fk_tags',
        foreignKeyName: '__fk_tag_target',
      },
    },
    {
      id: notesId,
      name: 'Notes',
      dbFieldName: 'notes',
      type: 'link',
      options: {
        relationship: 'oneMany',
        foreignTableId: targetTableId,
        lookupFieldId: targetNameId,
        isOneWay: true,
        fkHostTableName: junctionNotes,
        selfKeyName: '__fk_notes',
        foreignKeyName: '__fk_note_target',
      },
    },
  ],
  views: [{ id: `viw${'a'.repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
});

const targetDto = (): ITablePersistenceDTO => ({
  id: targetTableId,
  baseId,
  name: 'Target',
  dbTableName: targetPhysical,
  primaryFieldId: targetNameId,
  fields: [
    { id: targetNameId, name: 'Name', dbFieldName: 'name', type: 'singleLineText' },
    { id: amountId, name: 'Amount', dbFieldName: 'amount', type: 'number' },
    { id: targetDueId, name: 'Due', dbFieldName: 'due', type: 'date' },
    {
      id: departmentLinkId,
      name: 'Department',
      dbFieldName: 'department',
      type: 'link',
      options: {
        relationship: 'manyOne',
        foreignTableId: departmentTableId,
        lookupFieldId: departmentNameId,
        isOneWay: true,
        fkHostTableName: targetPhysical,
        selfKeyName: '__id',
        foreignKeyName: 'fk_department',
      },
    },
  ],
  views: [{ id: `viw${'b'.repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
});

const departmentDto = (): ITablePersistenceDTO => ({
  id: departmentTableId,
  baseId,
  name: 'Department',
  dbTableName: departmentPhysical,
  primaryFieldId: departmentNameId,
  fields: [{ id: departmentNameId, name: 'Name', dbFieldName: 'name', type: 'singleLineText' }],
  views: [{ id: `viw${'c'.repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
});

const root = () => mapper.toDomain(rootDto())._unsafeUnwrap();
const target = () => mapper.toDomain(targetDto())._unsafeUnwrap();
const department = () => mapper.toDomain(departmentDto())._unsafeUnwrap();

describe('DataQueryDefinition relation extensions', () => {
  it('rejects a via that names a later or unknown relation', () => {
    for (const relations of [
      { child: { linkFieldId: ownerId, tableId: targetTableId, via: 'parent' } },
      {
        child: { linkFieldId: ownerId, tableId: targetTableId, via: 'missing' },
        parent: { linkFieldId: ownerId, tableId: targetTableId },
      },
    ]) {
      const result = DataQueryDefinition.create({
        version: 2,
        kind: 'records',
        tableId: rootTableId,
        relations,
        select: [{ system: 'id', alias: 'id' }],
      });
      expect(result._unsafeUnwrapErr().code).toBe('data_query.join_via');
    }
  });

  it('validates relation aggregate arity at definition time', () => {
    const relation = { items: { linkFieldId: itemsId, tableId: targetTableId } };
    const countWithField = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      relations: relation,
      select: [{ source: 'items', fieldId: amountId, statisticFunc: 'count', alias: 'n' }],
    });
    expect(countWithField._unsafeUnwrapErr().code).toBe('data_query.relation_aggregate_field');
    const sumWithoutField = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      relations: relation,
      select: [{ source: 'items', statisticFunc: 'sum', alias: 'total' }],
    });
    expect(sumWithoutField._unsafeUnwrapErr().code).toBe('data_query.relation_aggregate_field');
    const rootAggregate = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      relations: relation,
      select: [{ source: 'root', fieldId: amountId, statisticFunc: 'sum', alias: 'total' }],
    });
    expect(rootAggregate._unsafeUnwrapErr().code).toBe('data_query.relation_aggregate_source');
  });

  it('keeps version 1 free of buckets and relation aggregates', () => {
    const bucket = DataQueryDefinition.create({
      version: 1,
      kind: 'records',
      tableId: rootTableId,
      select: [
        {
          fieldId: dueId,
          alias: 'due',
          bucket: { kind: 'dateTrunc', unit: 'month', timeZone: 'UTC' },
        },
      ],
    });
    expect(bucket._unsafeUnwrapErr().code).toBe('data_query.invalid_definition');
    const aggregate = DataQueryDefinition.create({
      version: 1,
      kind: 'records',
      tableId: rootTableId,
      select: [{ source: 'items', statisticFunc: 'count', alias: 'n' }],
    });
    expect(aggregate._unsafeUnwrapErr().code).toBe('data_query.invalid_definition');
  });

  it('rejects malformed bucket declarations', () => {
    const nonAscending = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      select: [
        {
          fieldId: amountId,
          alias: 'band',
          bucket: {
            kind: 'numericRange',
            edges: [
              { maxExclusive: 10, label: 'low' },
              { maxExclusive: 10, label: 'mid' },
            ],
            fallbackLabel: 'high',
          },
        },
      ],
    });
    expect(nonAscending._unsafeUnwrapErr().code).toBe('data_query.invalid_definition');
    const invalidZone = DataQueryDefinition.create({
      version: 2,
      kind: 'aggregate',
      tableId: rootTableId,
      aggregates: [{ fieldId: amountId, statisticFunc: 'sum', alias: 'total' }],
      groupBy: [
        {
          fieldId: dueId,
          alias: 'month',
          bucket: { kind: 'dateTrunc', unit: 'month', timeZone: 'Not/AZone' },
        },
      ],
    });
    expect(invalidZone._unsafeUnwrapErr().code).toBe('data_query.invalid_definition');
  });

  it('allows alias sorting only for relation aggregate outputs', () => {
    const relation = { items: { linkFieldId: itemsId, tableId: targetTableId } };
    const allowed = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      relations: relation,
      select: [
        { system: 'id', alias: 'id' },
        { source: 'items', statisticFunc: 'count', alias: 'itemCount' },
      ],
      sort: [{ alias: 'itemCount', order: 'desc' }],
    });
    expect(allowed.isOk()).toBe(true);
    const rejected = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      relations: relation,
      select: [{ system: 'id', alias: 'id' }],
      sort: [{ alias: 'id', order: 'asc' }],
    });
    expect(rejected._unsafeUnwrapErr().code).toBe('data_query.aggregate_sort');
  });

  it('rejects sorting a bucketed group by field id', () => {
    const result = DataQueryDefinition.create({
      version: 2,
      kind: 'aggregate',
      tableId: rootTableId,
      aggregates: [{ fieldId: amountId, statisticFunc: 'sum', alias: 'total' }],
      groupBy: [
        {
          fieldId: dueId,
          alias: 'month',
          bucket: { kind: 'dateTrunc', unit: 'month', timeZone: 'UTC' },
        },
      ],
      sort: [{ fieldId: dueId, order: 'asc' }],
    });
    expect(result._unsafeUnwrapErr().code).toBe('data_query.bucket_sort');
  });
});

describe('DataQueryRelationBinding relation extensions', () => {
  it('binds a two-way one-many link as a per-root aggregate source', () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      relations: { items: { linkFieldId: itemsId, tableId: targetTableId } },
      select: [
        { system: 'id', alias: 'id' },
        { source: 'items', statisticFunc: 'count', alias: 'itemCount' },
        { source: 'items', fieldId: amountId, statisticFunc: 'sum', alias: 'itemTotal' },
        { source: 'items', fieldId: amountId, statisticFunc: 'unique', alias: 'values' },
      ],
    })._unsafeUnwrap();
    const binding = DataQueryRelationBinding.prepare(
      definition,
      root(),
      new Map([['items', target()]])
    )._unsafeUnwrap();

    expect(binding.sources).toHaveLength(1);
    expect(binding.sources[0]).toMatchObject({
      alias: 'items',
      parentAlias: 'root',
      cardinality: 'many',
      linkStorage: { kind: 'target-fk-many', column: 'fk_items' },
    });
    expect(binding.rootDependencies).toEqual([
      expect.objectContaining({ fieldId: itemsId, usages: ['relation'] }),
    ]);
    expect(binding.sources[0].dependencies).toEqual([
      expect.objectContaining({ fieldId: amountId, usages: ['aggregate'] }),
    ]);
    expect(binding.plan.sources[0]).toMatchObject({
      alias: 'items',
      cardinality: 'many',
      link: { kind: 'target-fk-many', column: 'fk_items' },
    });
    expect(binding.plan.projections).toEqual(
      expect.arrayContaining([
        {
          kind: 'aggregate',
          source: 'items',
          alias: 'itemCount',
          statisticFunc: 'count',
          column: null,
        },
        {
          kind: 'aggregate',
          source: 'items',
          alias: 'itemTotal',
          statisticFunc: 'sum',
          fieldId: amountId,
          column: 'amount',
        },
      ])
    );
    expect(binding.plan.usage).toEqual(
      expect.arrayContaining([{ source: 'items', fieldId: amountId, usages: ['aggregate'] }])
    );
    expect(binding.outputs).toEqual([
      {
        alias: 'id',
        wireType: 'string',
        cellValueType: 'string',
        isMultipleCellValue: false,
        nullable: false,
      },
      {
        alias: 'itemCount',
        wireType: 'numberOrString',
        cellValueType: 'number',
        isMultipleCellValue: false,
        nullable: false,
      },
      {
        alias: 'itemTotal',
        wireType: 'numberOrString',
        cellValueType: 'number',
        isMultipleCellValue: false,
        nullable: true,
      },
      {
        alias: 'values',
        wireType: 'numberOrString',
        cellValueType: 'number',
        isMultipleCellValue: false,
        nullable: false,
      },
    ]);
  });

  it('includes aggregate-query relation metrics in the plan', () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'aggregate',
      tableId: rootTableId,
      relations: { items: { linkFieldId: itemsId, tableId: targetTableId } },
      groupBy: [{ fieldId: titleId, alias: 'title' }],
      aggregates: [
        { source: 'items', statisticFunc: 'count', alias: 'itemCount' },
        { source: 'items', fieldId: amountId, statisticFunc: 'sum', alias: 'itemTotal' },
      ],
    })._unsafeUnwrap();

    const binding = DataQueryRelationBinding.prepare(
      definition,
      root(),
      new Map([['items', target()]])
    )._unsafeUnwrap();

    expect(binding.plan.aggregates).toEqual([
      { source: 'items', alias: 'itemCount', statisticFunc: 'count', column: null },
      {
        source: 'items',
        alias: 'itemTotal',
        statisticFunc: 'sum',
        fieldId: amountId,
        column: 'amount',
      },
    ]);
    expect(binding.plan.groupBy).toEqual([
      { source: 'root', fieldId: titleId, column: 'title', alias: 'title' },
    ]);
  });

  it('derives junction storage for many-many and one-way one-many links', () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      relations: {
        tags: { linkFieldId: tagsId, tableId: targetTableId },
        notes: { linkFieldId: notesId, tableId: targetTableId },
      },
      select: [
        { system: 'id', alias: 'id' },
        { source: 'tags', statisticFunc: 'count', alias: 'tagCount' },
        { source: 'notes', statisticFunc: 'count', alias: 'noteCount' },
      ],
    })._unsafeUnwrap();
    const binding = DataQueryRelationBinding.prepare(
      definition,
      root(),
      new Map([
        ['tags', target()],
        ['notes', target()],
      ])
    )._unsafeUnwrap();

    expect(binding.sources.map((source) => source.linkStorage)).toEqual([
      {
        kind: 'junction',
        schema: 'public',
        tableName: 'junction_tags',
        selfKeyName: '__fk_tags',
        foreignKeyName: '__fk_tag_target',
      },
      {
        kind: 'junction',
        schema: 'public',
        tableName: 'junction_notes',
        selfKeyName: '__fk_notes',
        foreignKeyName: '__fk_note_target',
      },
    ]);
    expect(binding.plan.sources.map((source) => source.link)).toEqual(
      binding.sources.map((source) => source.linkStorage)
    );
  });

  it('rejects stored projections, sorts and to-one aggregates on the wrong cardinality', () => {
    const relation = { items: { linkFieldId: itemsId, tableId: targetTableId } };
    const projection = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      relations: relation,
      select: [
        { system: 'id', alias: 'id' },
        { source: 'items', fieldId: amountId, alias: 'amount' },
      ],
    })._unsafeUnwrap();
    expect(
      DataQueryRelationBinding.prepare(
        projection,
        root(),
        new Map([['items', target()]])
      )._unsafeUnwrapErr().code
    ).toBe('data_query.join_projection_multi');

    const sort = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      relations: relation,
      select: [{ system: 'id', alias: 'id' }],
      sort: [{ source: 'items', fieldId: amountId, order: 'asc' }],
    })._unsafeUnwrap();
    expect(
      DataQueryRelationBinding.prepare(
        sort,
        root(),
        new Map([['items', target()]])
      )._unsafeUnwrapErr().code
    ).toBe('data_query.join_sort_multi');

    const toOneAggregate = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      relations: { owner: { linkFieldId: ownerId, tableId: targetTableId } },
      select: [
        { system: 'id', alias: 'id' },
        { source: 'owner', statisticFunc: 'count', alias: 'n' },
      ],
    })._unsafeUnwrap();
    expect(
      DataQueryRelationBinding.prepare(
        toOneAggregate,
        root(),
        new Map([['owner', target()]])
      )._unsafeUnwrapErr().code
    ).toBe('data_query.join_aggregate_cardinality');
  });

  it('rejects incompatible aggregate field types', () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      relations: { items: { linkFieldId: itemsId, tableId: targetTableId } },
      select: [{ source: 'items', fieldId: targetNameId, statisticFunc: 'sum', alias: 'total' }],
    })._unsafeUnwrap();
    expect(
      DataQueryRelationBinding.prepare(
        definition,
        root(),
        new Map([['items', target()]])
      )._unsafeUnwrapErr().code
    ).toBe('data_query.relation_aggregate_type');
  });

  it('binds a multi-hop to-one chain and keeps every hop authorized separately', () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      relations: {
        owner: { linkFieldId: ownerId, tableId: targetTableId },
        ownerDepartment: {
          linkFieldId: departmentLinkId,
          tableId: departmentTableId,
          via: 'owner',
        },
      },
      select: [
        { system: 'id', alias: 'id' },
        { source: 'owner', fieldId: targetNameId, alias: 'ownerName' },
        { source: 'ownerDepartment', fieldId: departmentNameId, alias: 'departmentName' },
      ],
    })._unsafeUnwrap();
    const binding = DataQueryRelationBinding.prepare(
      definition,
      root(),
      new Map([
        ['owner', target()],
        ['ownerDepartment', department()],
      ])
    )._unsafeUnwrap();

    expect(binding.sources.map((source) => source.parentAlias)).toEqual(['root', 'owner']);
    expect(
      binding.plan.sources.map(({ alias, parentAlias, cardinality }) => ({
        alias,
        parentAlias,
        cardinality,
      }))
    ).toEqual([
      { alias: 'owner', parentAlias: 'root', cardinality: 'one' },
      { alias: 'ownerDepartment', parentAlias: 'owner', cardinality: 'one' },
    ]);
    expect(binding.plan.sources.map((source) => source.link)).toEqual(
      binding.sources.map((source) => source.linkStorage)
    );
    expect(binding.sources[0].cardinality).toBe('one');
    expect(binding.sources[0].dependencies).toContainEqual(
      expect.objectContaining({ fieldId: departmentLinkId, usages: ['relation'] })
    );
    expect(binding.rootDependencies).toEqual([
      expect.objectContaining({ fieldId: ownerId, usages: ['relation'] }),
    ]);
    expect(binding.outputs.map((output) => output.alias)).toEqual([
      'id',
      'ownerName',
      'departmentName',
    ]);
  });

  it('refuses to hop through a to-many relation', () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      relations: {
        items: { linkFieldId: itemsId, tableId: targetTableId },
        child: { linkFieldId: departmentLinkId, tableId: departmentTableId, via: 'items' },
      },
      select: [{ system: 'id', alias: 'id' }],
    })._unsafeUnwrap();
    expect(
      DataQueryRelationBinding.prepare(
        definition,
        root(),
        new Map([
          ['items', target()],
          ['child', department()],
        ])
      )._unsafeUnwrapErr().code
    ).toBe('data_query.join_via');
  });

  it('describes date and numeric buckets and validates their field types', () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      relations: { owner: { linkFieldId: ownerId, tableId: targetTableId } },
      select: [
        { system: 'id', alias: 'id' },
        {
          source: 'owner',
          fieldId: targetDueId,
          alias: 'month',
          bucket: { kind: 'dateTrunc', unit: 'month', timeZone: 'Asia/Shanghai' },
        },
        {
          fieldId: dueId,
          alias: 'band',
          bucket: {
            kind: 'dateDifferenceRange',
            unit: 'day',
            timeZone: 'UTC',
            edges: [
              { maxExclusive: 0, label: 'future' },
              { maxExclusive: 31, label: 'current' },
            ],
            fallbackLabel: 'overdue',
            nullLabel: 'missing',
          },
        },
      ],
    })._unsafeUnwrap();
    const binding = DataQueryRelationBinding.prepare(
      definition,
      root(),
      new Map([['owner', target()]])
    )._unsafeUnwrap();

    expect(binding.outputs).toEqual([
      expect.objectContaining({ alias: 'id' }),
      {
        alias: 'month',
        wireType: 'string',
        cellValueType: 'string',
        isMultipleCellValue: false,
        nullable: true,
      },
      {
        alias: 'band',
        wireType: 'string',
        cellValueType: 'string',
        isMultipleCellValue: false,
        nullable: false,
      },
    ]);

    const incompatible = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      relations: { owner: { linkFieldId: ownerId, tableId: targetTableId } },
      select: [
        {
          source: 'owner',
          fieldId: targetNameId,
          alias: 'bad',
          bucket: { kind: 'dateTrunc', unit: 'month', timeZone: 'UTC' },
        },
      ],
    })._unsafeUnwrap();
    expect(
      DataQueryRelationBinding.prepare(
        incompatible,
        root(),
        new Map([['owner', target()]])
      )._unsafeUnwrapErr().code
    ).toBe('data_query.bucket_field');
  });
});

describe('Relation query binding regressions', () => {
  it('records the root filter as a dependency and rejects it without read access', () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      relations: { owner: { linkFieldId: ownerId, tableId: targetTableId } },
      select: [
        { system: 'id', alias: 'id' },
        { source: 'owner', fieldId: targetNameId, alias: 'ownerName' },
      ],
      filter: { fieldId: titleId, operator: 'is', value: 'Alpha' },
    })._unsafeUnwrap();
    const binding = DataQueryRelationBinding.prepare(
      definition,
      root(),
      new Map([['owner', target()]])
    )._unsafeUnwrap();

    expect(binding.rootDependencies).toContainEqual(
      expect.objectContaining({ fieldId: titleId, usages: ['filter'] })
    );
    // A plugin returning only readableFieldIds (no masks) must fail closed.
    const rootAccess = dataQueryAccessForSource(binding.plan, 'root');
    const forbidden = assertDataQueryAccess(rootAccess, {
      readableFieldIds: new Set([ownerId]),
    })._unsafeUnwrapErr();
    expect(forbidden.code).toBe('data_query.field_forbidden');
    expect(forbidden.details?.fieldId).toBe(titleId);
    expect(
      assertDataQueryAccess(rootAccess, {
        readableFieldIds: new Set([titleId, ownerId]),
      }).isOk()
    ).toBe(true);
  });

  it('treats a parameter used only by a relation filter as optional', () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      parameters: { owner: { type: 'string' } },
      relations: {
        owner: {
          linkFieldId: ownerId,
          tableId: targetTableId,
          filter: {
            fieldId: targetNameId,
            operator: 'is',
            value: { type: 'parameter', name: 'owner' },
            optional: true,
          },
        },
      },
      select: [{ system: 'id', alias: 'id' }],
    })._unsafeUnwrap();

    expect(dataQueryOptionalParameters(definition.snapshot()).has('owner')).toBe(true);
    expect(definition.bind({})._unsafeUnwrap().relationFilters).toBeUndefined();
    expect(
      definition.bind({ owner: 'Alpha' })._unsafeUnwrap().relationFilters?.owner
    ).toBeDefined();
  });

  it('rejects offset time zones that PostgreSQL would flip', () => {
    const offset = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      select: [
        {
          fieldId: dueId,
          alias: 'month',
          bucket: { kind: 'dateTrunc', unit: 'month', timeZone: '+05:00' },
        },
      ],
    });
    expect(offset._unsafeUnwrapErr().code).toBe('data_query.invalid_definition');
    const utc = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      select: [
        {
          fieldId: dueId,
          alias: 'month',
          bucket: { kind: 'dateTrunc', unit: 'month', timeZone: 'UTC' },
        },
      ],
    });
    expect(utc.isOk()).toBe(true);
  });

  it('rejects a parameterized to-many system sort at prepare time', () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      parameters: { sortField: { type: 'string' } },
      relations: { items: { linkFieldId: itemsId, tableId: targetTableId } },
      select: [{ system: 'id', alias: 'id' }],
      sort: [
        {
          field: { type: 'parameter', name: 'sortField' },
          order: 'asc',
          allowed: [{ source: 'items', system: 'id' }],
        },
      ],
    })._unsafeUnwrap();
    expect(
      DataQueryRelationBinding.prepare(
        definition,
        root(),
        new Map([['items', target()]])
      )._unsafeUnwrapErr().code
    ).toBe('data_query.join_sort_multi');
  });

  it('rejects integer-like relation aliases whose order JS cannot preserve', () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      relations: { '1': { linkFieldId: ownerId, tableId: targetTableId } },
      select: [{ system: 'id', alias: 'id' }],
    });
    expect(definition._unsafeUnwrapErr().code).toBe('data_query.join_alias_order');
  });
});

describe('V5 root relation existence', () => {
  const input = (): DataQueryDefinitionV5Input => ({
    version: 5,
    kind: 'records',
    tableId: rootTableId,
    relations: {
      items: {
        linkFieldId: itemsId,
        tableId: targetTableId,
        filter: {
          fieldId: amountId,
          operator: 'isGreater',
          value: { type: 'parameter', name: 'minimum' },
          optional: true,
        },
      },
    },
    parameters: { minimum: { type: 'number', nullable: true } },
    filter: {
      conjunction: 'or',
      items: [
        { fieldId: titleId, operator: 'is', value: 'active' },
        { not: { relation: 'items', quantifier: 'none' } },
      ],
    },
    select: [{ system: 'id', alias: 'id' }],
  });
  const prepare = (value: unknown = input()) =>
    DataQueryRelationBinding.prepare(
      DataQueryDefinition.create(value)._unsafeUnwrap(),
      root(),
      new Map([['items', target()]])
    )._unsafeUnwrap();

  it('admits the structural leaf only in V5 root Boolean trees', () => {
    expect(prepare().plan.predicate).toMatchObject({
      kind: 'group',
      conjunction: 'or',
      items: [
        { kind: 'legacy', source: 'root' },
        { kind: 'not', predicate: { kind: 'exists', relation: 'items', quantifier: 'none' } },
      ],
    });
    for (const version of [1, 2, 3, 4])
      expect(DataQueryDefinition.create({ ...input(), version }).isErr()).toBe(true);
    for (const leaf of [
      { relation: 'items', quantifier: 'all' },
      {
        relation: 'items',
        quantifier: 'any',
        where: { fieldId: amountId, operator: 'is', value: 1 },
      },
      { relation: 'items', quantifier: 'any', optional: true },
    ])
      expect(DataQueryDefinition.create({ ...input(), filter: leaf }).isErr()).toBe(true);
    for (const relation of ['root', 'missing'])
      expect(
        DataQueryDefinition.create({
          ...input(),
          filter: { not: { relation, quantifier: 'any' } },
        })._unsafeUnwrapErr().code
      ).toBe('data_query.join_source_unknown');
    expect(
      DataQueryDefinition.create({
        ...input(),
        relations: {
          items: {
            linkFieldId: itemsId,
            tableId: targetTableId,
            filter: { relation: 'items', quantifier: 'any' },
          },
        },
      }).isErr()
    ).toBe(true);
    expect(
      DataQueryDefinition.create({
        ...input(),
        kind: 'aggregate',
        select: undefined,
        aggregates: [
          {
            fieldId: titleId,
            statisticFunc: 'count',
            alias: 'n',
            filter: { relation: 'items', quantifier: 'any' },
          },
        ],
      }).isErr()
    ).toBe(true);
  });

  it('preserves optional parameter absence and explicit scalar values without disabling existence', () => {
    const definition = DataQueryDefinition.create(input())._unsafeUnwrap();
    expect(dataQueryOptionalParameters(definition.snapshot()).has('minimum')).toBe(true);
    expect(definition.bind({}).isOk()).toBe(true);
    for (const minimum of [null, 0, 1])
      expect(definition.bind({ minimum })._unsafeUnwrap().expressionParameters).toEqual({
        minimum,
      });
    expect(prepare().plan.predicate).toMatchObject({ kind: 'group' });
    const required = input();
    required.filter = {
      type: 'formula',
      formula: '{minimum} > 0',
      references: { minimum: { type: 'parameter', name: 'minimum' } },
    };
    const mustSupply = DataQueryDefinition.create(required)._unsafeUnwrap();
    expect(dataQueryOptionalParameters(mustSupply.snapshot()).has('minimum')).toBe(false);
    expect(mustSupply.bind({})._unsafeUnwrapErr().code).toBe('data_query.missing_parameter');
  });

  it('tracks local predicate dependencies and rejects unreadable Link and matching fields', () => {
    const binding = prepare();
    expect(binding.plan.usage).toEqual(
      expect.arrayContaining([
        { source: 'root', fieldId: itemsId, usages: ['relation'] },
        { source: 'items', fieldId: amountId, usages: ['filter', 'existence'] },
      ])
    );
    expect(
      assertDataQueryAccess(dataQueryAccessForSource(binding.plan, 'root'), {
        readableFieldIds: new Set([titleId]),
      })._unsafeUnwrapErr().code
    ).toBe('data_query.field_forbidden');
    expect(
      assertDataQueryAccess(dataQueryAccessForSource(binding.plan, 'items'), {
        readableFieldIds: new Set([targetNameId]),
      })._unsafeUnwrapErr().code
    ).toBe('data_query.field_forbidden');
  });

  it('includes unused declared formula dependencies even when optional filters prune', () => {
    const value = input();
    value.relations!.items.filter = {
      type: 'formula',
      formula: '1 = 1',
      references: {
        unused: { type: 'field', fieldId: targetNameId },
      },
    };
    const binding = prepare(value);
    expect(dataQueryAccessForSource(binding.plan, 'items').usage).toEqual(
      expect.arrayContaining([expect.objectContaining({ fieldId: targetNameId })])
    );
  });

  it('requires static readability for masked existence predicates without changing historical filters', () => {
    const fieldMasks = [
      {
        fieldId: amountId,
        visibleWhen: buildRecordConditionSpec(target(), {
          fieldId: amountId,
          operator: 'isGreater',
          value: 0,
        })._unsafeUnwrap(),
      },
    ];
    for (const version of [4, 5]) {
      for (const existence of [false, true]) {
        if (version === 4 && existence) continue;
        const value = { ...input(), version, filter: existence ? input().filter : undefined };
        const access = dataQueryAccessForSource(prepare(value).plan, 'items');
        const denied = assertDataQueryAccess(access, {
          readableFieldIds: new Set([targetNameId]),
          fieldMasks,
        });
        if (existence) expect(denied._unsafeUnwrapErr().code).toBe('data_query.field_forbidden');
        else expect(denied.isOk()).toBe(true);
        expect(
          assertDataQueryAccess(access, {
            readableFieldIds: new Set([targetNameId, amountId]),
            fieldMasks,
          }).isOk()
        ).toBe(true);
      }
    }
  });

  it('requires every selected-path filter dependency but leaves other source usages unchanged', async () => {
    const targetData = targetDto();
    const owner = mapper
      .toDomain({
        ...targetData,
        fields: [
          ...targetData.fields,
          { id: tagsId, name: 'Threshold', dbFieldName: 'threshold', type: 'number' },
        ],
      })
      ._unsafeUnwrap();
    const definition = DataQueryDefinition.create({
      version: 5,
      kind: 'records',
      tableId: rootTableId,
      relations: {
        owner: {
          linkFieldId: ownerId,
          tableId: targetTableId,
          filter: {
            conjunction: 'and',
            items: [
              {
                fieldId: amountId,
                operator: 'isGreater',
                value: { type: 'field', fieldId: tagsId },
              },
              {
                type: 'formula',
                formula: '1 = 1',
                references: { unused: { type: 'field', fieldId: targetNameId } },
              },
            ],
          },
        },
        department: {
          via: 'owner',
          linkFieldId: departmentLinkId,
          tableId: departmentTableId,
          filter: { fieldId: departmentNameId, operator: 'is', value: 'active' },
        },
        items: {
          linkFieldId: itemsId,
          tableId: targetTableId,
          filter: { fieldId: amountId, operator: 'isGreater', value: 0 },
        },
      },
      filter: {
        conjunction: 'and',
        items: [
          { fieldId: titleId, operator: 'is', value: 'active' },
          { not: { relation: 'department', quantifier: 'none' } },
        ],
      },
      select: [
        {
          alias: 'constant',
          expr: {
            type: 'formula',
            formula: '1',
            references: { unused: { type: 'field', fieldId: dueId } },
          },
        },
        {
          alias: 'ownerConstant',
          expr: {
            type: 'formula',
            formula: '1',
            references: { unused: { type: 'field', source: 'owner', fieldId: targetDueId } },
          },
        },
      ],
    })._unsafeUnwrap();
    const binding = DataQueryRelationBinding.prepare(
      definition,
      root(),
      new Map([
        ['owner', owner],
        ['department', department()],
        ['items', target()],
      ])
    )._unsafeUnwrap();
    expect(binding.plan.usage).toEqual(
      expect.arrayContaining([
        { source: 'root', fieldId: titleId, usages: ['filter'] },
        { source: 'root', fieldId: dueId, usages: ['projection', 'reference'] },
        { source: 'owner', fieldId: targetDueId, usages: ['projection', 'reference'] },
        { source: 'owner', fieldId: amountId, usages: ['filter', 'existence'] },
        { source: 'owner', fieldId: tagsId, usages: ['reference', 'existence'] },
        { source: 'owner', fieldId: targetNameId, usages: ['filter', 'reference', 'existence'] },
        { source: 'department', fieldId: departmentNameId, usages: ['filter', 'existence'] },
        { source: 'items', fieldId: amountId, usages: ['filter'] },
      ])
    );
    const access = dataQueryAccessForSource(binding.plan, 'owner');
    const readable = [amountId, tagsId, targetNameId, departmentLinkId, targetDueId];
    const visibleWhen = buildRecordConditionSpec(owner, {
      fieldId: amountId,
      operator: 'isGreater',
      value: 0,
    })._unsafeUnwrap();
    for (const fieldId of [amountId, tagsId, targetNameId]) {
      const fieldMasks = [{ fieldId, visibleWhen }];
      expect(
        assertDataQueryAccess(access, {
          readableFieldIds: new Set(readable.filter((id) => id !== fieldId)),
          fieldMasks,
        })._unsafeUnwrapErr().code
      ).toBe('data_query.field_forbidden');
      expect(
        assertDataQueryAccess(access, { readableFieldIds: new Set(readable), fieldMasks }).isOk()
      ).toBe(true);
      for (const allowed of [false, true]) {
        const plugins = new RecordQueryPluginRunner(
          [
            {
              name: 'existence-read-scope',
              supports: () => true,
              scope: ({ table }) =>
                ok(
                  table.id().toString() === targetTableId
                    ? {
                        readableFieldIds: new Set(
                          allowed ? readable : readable.filter((id) => id !== fieldId)
                        ),
                        fieldMasks,
                      }
                    : {}
                ),
            },
          ],
          new NoopLogger()
        );
        const authorized = await authorizeDataQueryExpressionDependencies(
          { actorId: ActorId.create('reader')._unsafeUnwrap() },
          plugins,
          definition,
          root(),
          new Map([
            ['owner', owner],
            ['department', department()],
            ['items', target()],
          ])
        );
        if (allowed) expect(authorized.isOk()).toBe(true);
        else expect(authorized._unsafeUnwrapErr().code).toBe('data_query.field_forbidden');
      }
    }
  });

  it('inherits V4 metric parameters and HAVING binding', () => {
    const value = {
      ...input(),
      kind: 'aggregate',
      select: undefined,
      parameters: { minimum: { type: 'number' }, factor: { type: 'number' } },
      aggregates: [
        {
          expr: {
            type: 'formula',
            formula: '{factor}',
            references: { factor: { type: 'parameter', name: 'factor' } },
          },
          statisticFunc: 'sum',
          alias: 'total',
        },
      ],
      having: {
        type: 'formula',
        formula: '{total} >= {minimum}',
        references: {
          total: { type: 'output', alias: 'total' },
          minimum: { type: 'parameter', name: 'minimum' },
        },
      },
    };
    delete value.select;
    const definition = DataQueryDefinition.create(value)._unsafeUnwrap();
    expect(definition.bind({ minimum: 1 })._unsafeUnwrapErr().code).toBe(
      'data_query.missing_parameter'
    );
    expect(prepare(value).plan.having).toMatchObject({ kind: 'formula' });
  });

  it('fingerprints V5 source-qualified field contracts, not quantifier values', async () => {
    const first = prepare();
    const changed = input();
    changed.filter = { relation: 'items', quantifier: 'any' };
    const second = prepare(changed);
    const left = input();
    left.filter = { relation: 'items', quantifier: 'none' };
    const third = prepare(left);
    const tables = new Map([
      ['root', root()],
      ['items', target()],
    ]);
    const signature = async (binding: typeof first) =>
      (await dataQuerySchemaSignature(binding.plan, tables, binding.outputs))._unsafeUnwrap();
    expect(await signature(second)).toBe(await signature(third));
    expect(await signature(first)).not.toBe(await signature(second));
    const legacy = DataQueryDefinition.create({
      ...changed,
      version: 4,
      filter: undefined,
    })._unsafeUnwrap();
    const legacyBinding = DataQueryRelationBinding.prepare(
      legacy,
      root(),
      new Map([['items', target()]])
    )._unsafeUnwrap();
    expect(await signature(legacyBinding)).not.toBe(await signature(second));
  });
});
