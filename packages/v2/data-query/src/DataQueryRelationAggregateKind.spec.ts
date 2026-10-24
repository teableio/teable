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
const targetNameId = `fld${'g'.repeat(16)}`;
const departmentLinkId = `fld${'j'.repeat(16)}`;
const departmentNameId = `fld${'k'.repeat(16)}`;
const rootPhysical = 'public.agg_root';
const targetPhysical = 'public.agg_target';
const departmentPhysical = 'public.agg_department';
const mapper = new DefaultTableMapper();

const rootDto = (): ITablePersistenceDTO => ({
  id: rootTableId,
  baseId,
  name: 'Root',
  dbTableName: rootPhysical,
  primaryFieldId: titleId,
  fields: [
    { id: titleId, name: 'Title', dbFieldName: 'title', type: 'singleLineText' },
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

describe('Aggregate queries with to-one relations', () => {
  it('groups salary rows by a two-hop source field', () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'aggregate',
      tableId: rootTableId,
      relations: {
        owner: { linkFieldId: ownerId, tableId: targetTableId },
        department: {
          linkFieldId: departmentLinkId,
          tableId: departmentTableId,
          via: 'owner',
        },
      },
      aggregates: [{ fieldId: titleId, statisticFunc: 'count', alias: 'rows' }],
      groupBy: [{ source: 'department', fieldId: departmentNameId, alias: 'department' }],
      sort: [{ alias: 'department', order: 'asc' }],
      page: { limit: 10, includeTotal: true },
    })._unsafeUnwrap();
    const binding = DataQueryRelationBinding.prepare(
      definition,
      root(),
      new Map([
        ['owner', target()],
        ['department', department()],
      ])
    )._unsafeUnwrap();

    expect(binding.sources.map((source) => source.parentAlias)).toEqual(['root', 'owner']);
    expect(binding.outputs).toEqual([
      {
        alias: 'department',
        wireType: 'string',
        cellValueType: 'string',
        isMultipleCellValue: false,
        nullable: true,
      },
      {
        alias: 'rows',
        wireType: 'numberOrString',
        cellValueType: 'number',
        isMultipleCellValue: false,
        nullable: false,
      },
    ]);
  });

  it('rejects a to-many groupBy and source-field sorting in aggregate queries', () => {
    const manyGroup = DataQueryDefinition.create({
      version: 2,
      kind: 'aggregate',
      tableId: rootTableId,
      relations: { items: { linkFieldId: itemsId, tableId: targetTableId } },
      aggregates: [{ fieldId: titleId, statisticFunc: 'count', alias: 'rows' }],
      groupBy: [{ source: 'items', fieldId: targetNameId, alias: 'item' }],
    })._unsafeUnwrap();
    expect(
      DataQueryRelationBinding.prepare(
        manyGroup,
        root(),
        new Map([['items', target()]])
      )._unsafeUnwrapErr().code
    ).toBe('data_query.join_aggregate_cardinality');

    const sourceSort = DataQueryDefinition.create({
      version: 2,
      kind: 'aggregate',
      tableId: rootTableId,
      relations: { owner: { linkFieldId: ownerId, tableId: targetTableId } },
      aggregates: [{ fieldId: titleId, statisticFunc: 'count', alias: 'rows' }],
      groupBy: [{ source: 'owner', fieldId: targetNameId, alias: 'owner' }],
      sort: [{ source: 'owner', fieldId: targetNameId, order: 'asc' }],
    });
    expect(sourceSort._unsafeUnwrapErr().code).toBe('data_query.aggregate_sort');
  });

  it('rejects a self-referential via chain', () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'aggregate',
      tableId: rootTableId,
      relations: {
        owner: { linkFieldId: ownerId, tableId: targetTableId, via: 'owner' },
      },
      aggregates: [{ fieldId: titleId, statisticFunc: 'count', alias: 'rows' }],
    });
    expect(definition._unsafeUnwrapErr().code).toBe('data_query.join_via');
  });

  it('allows field-id sorting of a root group whose alias differs', () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'aggregate',
      tableId: rootTableId,
      relations: { owner: { linkFieldId: ownerId, tableId: targetTableId } },
      aggregates: [{ fieldId: titleId, statisticFunc: 'count', alias: 'rows' }],
      groupBy: [{ fieldId: titleId, alias: 'rootTitle' }],
      sort: [{ fieldId: titleId, order: 'desc' }],
      page: { limit: 10, includeTotal: true },
    })._unsafeUnwrap();
    expect(
      DataQueryRelationBinding.prepare(definition, root(), new Map([['owner', target()]])).isOk()
    ).toBe(true);
  });
});
