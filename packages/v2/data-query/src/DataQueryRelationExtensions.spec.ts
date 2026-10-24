import { DefaultTableMapper, type ITablePersistenceDTO } from '@teable/v2-core';
import { describe, expect, it } from 'vitest';

import { DataQueryRelationBinding } from './DataQueryBinding';
import { DataQueryDefinition } from './DataQueryDefinition';

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
