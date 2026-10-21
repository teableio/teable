import { describe, expect, it } from 'vitest';

import { BaseId } from '../../base/BaseId';
import { FieldId } from '../fields/FieldId';
import { FieldName } from '../fields/FieldName';
import { LinkFieldConfig } from '../fields/types/LinkFieldConfig';
import { RecordId } from '../records/RecordId';
import { Table } from '../Table';
import { TableId } from '../TableId';
import { TableName } from '../TableName';

const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
const tableId = (seed: string) => TableId.create(`tbl${seed.repeat(16)}`)._unsafeUnwrap();
const fieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`)._unsafeUnwrap();
const recordId = (seed: string) => RecordId.create(`rec${seed.repeat(16)}`)._unsafeUnwrap();

const buildTables = (options?: { withFilter?: boolean }) => {
  const lookupBuilder = Table.builder()
    .withId(tableId('c'))
    .withBaseId(baseId)
    .withName(TableName.create('Lookup')._unsafeUnwrap());
  lookupBuilder
    .field()
    .singleLineText()
    .withId(fieldId('c'))
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  lookupBuilder.view().defaultGrid().done();
  const lookupTable = lookupBuilder.build()._unsafeUnwrap();

  const foreignLinkFieldId = fieldId('e');
  const foreignBuilder = Table.builder()
    .withId(tableId('b'))
    .withBaseId(baseId)
    .withName(TableName.create('Foreign')._unsafeUnwrap());
  foreignBuilder
    .field()
    .singleLineText()
    .withId(fieldId('b'))
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .primary()
    .done();
  foreignBuilder
    .field()
    .link()
    .withId(foreignLinkFieldId)
    .withName(FieldName.create('Lookup')._unsafeUnwrap())
    .withConfig(
      LinkFieldConfig.create({
        relationship: 'manyMany',
        foreignTableId: lookupTable.id().toString(),
        lookupFieldId: lookupTable.primaryFieldId().toString(),
        isOneWay: true,
      })._unsafeUnwrap()
    )
    .done();
  foreignBuilder.view().defaultGrid().done();
  const foreignTable = foreignBuilder.build()._unsafeUnwrap();

  const sourceLinkFieldId = fieldId('d');
  const sourceBuilder = Table.builder()
    .withId(tableId('a'))
    .withBaseId(baseId)
    .withName(TableName.create('Source')._unsafeUnwrap());
  sourceBuilder
    .field()
    .singleLineText()
    .withId(fieldId('a'))
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  sourceBuilder
    .field()
    .link()
    .withId(sourceLinkFieldId)
    .withName(FieldName.create('Foreign')._unsafeUnwrap())
    .withConfig(
      LinkFieldConfig.create({
        relationship: 'manyMany',
        foreignTableId: foreignTable.id().toString(),
        lookupFieldId: foreignTable.primaryFieldId().toString(),
        isOneWay: true,
        filter:
          options?.withFilter === false
            ? undefined
            : {
                conjunction: 'and',
                filterSet: [
                  {
                    fieldId: foreignLinkFieldId.toString(),
                    operator: 'isAnyOf',
                    value: [recordId('f').toString(), recordId('g').toString()],
                  },
                ],
              },
      })._unsafeUnwrap()
    )
    .done();
  sourceBuilder.view().defaultGrid().done();
  const sourceTable = sourceBuilder.build()._unsafeUnwrap();

  return {
    sourceTable,
    foreignTable,
    lookupTable,
    sourceLinkFieldId,
    foreignLinkFieldId,
    primaryFieldId: sourceTable.primaryFieldId(),
  };
};

describe('Table.fieldFilterLinkScope', () => {
  it('extracts the foreign Table and Link Field filter', () => {
    const setup = buildTables();
    const scope = setup.sourceTable.fieldFilterLinkScope(setup.sourceLinkFieldId)._unsafeUnwrap();

    expect(scope?.foreignTableId.equals(setup.foreignTable.id())).toBe(true);
    expect(scope?.filter).toEqual({
      conjunction: 'and',
      filterSet: [
        {
          fieldId: setup.foreignLinkFieldId.toString(),
          operator: 'isAnyOf',
          value: [recordId('f').toString(), recordId('g').toString()],
        },
      ],
    });
  });

  it('returns null when the Link Field has no filter', () => {
    const setup = buildTables({ withFilter: false });
    expect(
      setup.sourceTable.fieldFilterLinkScope(setup.sourceLinkFieldId)._unsafeUnwrap()
    ).toBeNull();
  });

  it('returns null for a non-link Field', () => {
    const setup = buildTables();
    expect(setup.sourceTable.fieldFilterLinkScope(setup.primaryFieldId)._unsafeUnwrap()).toBeNull();
  });

  it('rejects a Field that is not owned by the Table', () => {
    const setup = buildTables();
    expect(setup.sourceTable.fieldFilterLinkScope(fieldId('z'))._unsafeUnwrapErr().code).toBe(
      'not_found'
    );
  });
});
