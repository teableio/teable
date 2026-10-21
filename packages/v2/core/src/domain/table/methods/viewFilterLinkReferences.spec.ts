import { describe, expect, it } from 'vitest';

import { BaseId } from '../../base/BaseId';
import { FieldId } from '../fields/FieldId';
import { FieldName } from '../fields/FieldName';
import { LinkFieldConfig } from '../fields/types/LinkFieldConfig';
import { RecordId } from '../records/RecordId';
import { Table } from '../Table';
import { TableId } from '../TableId';
import { TableName } from '../TableName';
import { GridView } from '../views/types/GridView';
import { ViewId } from '../views/ViewId';
import { ViewName } from '../views/ViewName';
import { ViewQueryDefaults } from '../views/ViewQueryDefaults';

const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
const tableId = (seed: string) => TableId.create(`tbl${seed.repeat(16)}`)._unsafeUnwrap();
const fieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`)._unsafeUnwrap();
const recordId = (seed: string) => RecordId.create(`rec${seed.repeat(16)}`)._unsafeUnwrap();
const viewId = (seed: string) => ViewId.create(`viw${seed.repeat(16)}`)._unsafeUnwrap();

const buildForeignTable = (seed: string) => {
  const builder = Table.builder()
    .withId(tableId(seed))
    .withBaseId(baseId)
    .withName(TableName.create(`Foreign ${seed}`)._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withId(fieldId(seed))
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

const buildSourceTable = (options?: { sourceFilter?: unknown }) => {
  const foreignA = buildForeignTable('b');
  const foreignB = buildForeignTable('c');
  const linkFieldAId = fieldId('d');
  const linkFieldBId = fieldId('e');
  const nonLinkFieldId = fieldId('f');
  const ownedViewId = viewId('g');
  const builder = Table.builder()
    .withId(tableId('h'))
    .withBaseId(baseId)
    .withName(TableName.create('Source')._unsafeUnwrap());

  builder
    .field()
    .singleLineText()
    .withId(nonLinkFieldId)
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .link()
    .withId(linkFieldAId)
    .withName(FieldName.create('Foreign A')._unsafeUnwrap())
    .withConfig(
      LinkFieldConfig.create({
        relationship: 'manyMany',
        foreignTableId: foreignA.id().toString(),
        lookupFieldId: foreignA.primaryFieldId().toString(),
        isOneWay: true,
      })._unsafeUnwrap()
    )
    .done();
  builder
    .field()
    .link()
    .withId(linkFieldBId)
    .withName(FieldName.create('Foreign B')._unsafeUnwrap())
    .withConfig(
      LinkFieldConfig.create({
        relationship: 'manyMany',
        foreignTableId: foreignB.id().toString(),
        lookupFieldId: foreignB.primaryFieldId().toString(),
        isOneWay: true,
      })._unsafeUnwrap()
    )
    .done();
  builder.view().defaultGrid().done();
  const fieldsTable = builder.build()._unsafeUnwrap();
  const view = GridView.create({
    id: ownedViewId,
    name: ViewName.create('Grid')._unsafeUnwrap(),
  })._unsafeUnwrap();
  view
    .setQueryDefaults(
      ViewQueryDefaults.rehydrate(
        {},
        {
          sourceFilter: options?.sourceFilter ?? null,
        }
      )._unsafeUnwrap()
    )
    ._unsafeUnwrap();
  const table = Table.rehydrate({
    id: fieldsTable.id(),
    baseId: fieldsTable.baseId(),
    name: fieldsTable.name(),
    fields: fieldsTable.getFields(),
    views: [view],
    primaryFieldId: fieldsTable.primaryFieldId(),
  })._unsafeUnwrap();

  return {
    table,
    foreignA,
    foreignB,
    linkFieldAId,
    linkFieldBId,
    nonLinkFieldId,
    ownedViewId,
  };
};

describe('Table.viewFilterLinkReferences', () => {
  it('resolves nested Link Field references, groups by foreign Table, and deduplicates IDs', () => {
    const recordA1 = recordId('i');
    const recordA2 = recordId('j');
    const recordB1 = recordId('k');
    const setup = buildSourceTable({
      sourceFilter: {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: fieldId('d').toString(),
            operator: 'is',
            value: recordA1.toString(),
          },
          {
            conjunction: 'or',
            filterSet: [
              {
                fieldId: fieldId('d').toString(),
                operator: 'isAnyOf',
                value: [recordA1.toString(), recordA2.toString(), 'not-a-record'],
              },
              {
                fieldId: fieldId('f').toString(),
                operator: 'is',
                value: recordB1.toString(),
              },
            ],
          },
          {
            fieldId: fieldId('e').toString(),
            operator: 'isAnyOf',
            value: [recordB1.toString()],
          },
        ],
      },
    });

    const result = setup.table.viewFilterLinkReferences(setup.ownedViewId)._unsafeUnwrap();

    expect(
      result.map((reference) => ({
        tableId: reference.foreignTableId.toString(),
        lookupFieldId: reference.lookupFieldId.toString(),
        recordIds: reference.recordIds.map((id) => id.toString()),
      }))
    ).toEqual([
      {
        tableId: setup.foreignA.id().toString(),
        lookupFieldId: setup.foreignA.primaryFieldId().toString(),
        recordIds: [recordA1.toString(), recordA2.toString()],
      },
      {
        tableId: setup.foreignB.id().toString(),
        lookupFieldId: setup.foreignB.primaryFieldId().toString(),
        recordIds: [recordB1.toString()],
      },
    ]);
  });

  it('returns no references for a null filter', () => {
    const setup = buildSourceTable({ sourceFilter: null });

    expect(setup.table.viewFilterLinkReferences(setup.ownedViewId)._unsafeUnwrap()).toEqual([]);
  });

  it('keeps an empty foreign Table group for an array containing no valid Record IDs', () => {
    const setup = buildSourceTable({
      sourceFilter: {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: fieldId('d').toString(),
            operator: 'isAnyOf',
            value: ['invalid-record-id'],
          },
        ],
      },
    });

    const [reference] = setup.table.viewFilterLinkReferences(setup.ownedViewId)._unsafeUnwrap();

    expect(reference?.foreignTableId.equals(setup.foreignA.id())).toBe(true);
    expect(reference?.recordIds).toEqual([]);
  });

  it('rejects a View that is not owned by the Table aggregate', () => {
    const setup = buildSourceTable();

    const result = setup.table.viewFilterLinkReferences(viewId('z'));

    expect(result._unsafeUnwrapErr().code).toBe('view.not_found');
  });
});
