import {
  BaseId,
  FieldName,
  RecordId,
  Table,
  TableName,
  TableRecord,
  TableRecordCellValue,
  ViewName,
} from '@teable/v2-core';
import { describe, expect, it } from 'vitest';

import { printTable } from './printTable';

const createBaseId = (seed: string) => BaseId.create(`bse${seed.repeat(16)}`)._unsafeUnwrap();
const createRecordId = (seed: string) => RecordId.create(`rec${seed.repeat(16)}`)._unsafeUnwrap();

describe('printTable', () => {
  it('prints raw records with aligned columns', () => {
    const output = printTable({
      tableName: 'Links',
      fieldNames: ['Name', 'Links', 'Tags', 'Meta'],
      fieldIds: ['fldName', 'fldLinks', 'fldTags', 'fldMeta'],
      records: [
        {
          id: 'rec1',
          fields: {
            fldName: 'Alpha',
            fldLinks: [{ title: 'A' }, { title: 'B' }],
            fldTags: ['x', 'y'],
            fldMeta: { id: 'meta1' },
          },
        },
        {
          id: 'rec2',
          fields: {
            fldName: null,
            fldLinks: [],
            fldTags: '["foo","bar"]',
            fldMeta: { title: 'Obj' },
          },
        },
      ],
      options: { rowId: 'index' },
    });

    expect(output).toMatchInlineSnapshot(`
      "[Links]
      ---------------------------------------
      #  | Name  | Links | Tags       | Meta
      ---------------------------------------
      R0 | Alpha | A, B  | [x, y]     | meta1
      R1 | -     | []    | [foo, bar] | Obj
      ---------------------------------------"
    `);
  });

  it('prints domain table records with record ids', () => {
    const table = Table.builder()
      .withBaseId(createBaseId('a'))
      .withName(TableName.create('Orders')._unsafeUnwrap());

    table
      .field()
      .singleLineText()
      .withName(FieldName.create('Title')._unsafeUnwrap())
      .primary()
      .done();
    table.field().number().withName(FieldName.create('Count')._unsafeUnwrap()).done();
    table.view().grid().withName(ViewName.create('Grid')._unsafeUnwrap()).done();

    const builtTable = table.build()._unsafeUnwrap();
    const [titleField, countField] = builtTable.getFields();
    const record = TableRecord.create({
      id: createRecordId('a'),
      tableId: builtTable.id(),
      fieldValues: [
        { fieldId: titleField.id(), value: TableRecordCellValue.create('Widget')._unsafeUnwrap() },
        { fieldId: countField.id(), value: TableRecordCellValue.create(7)._unsafeUnwrap() },
      ],
    })._unsafeUnwrap();

    const output = printTable({
      table: builtTable,
      records: [record],
      options: { rowId: 'recordId' },
    });

    expect(output).toMatchInlineSnapshot(`
      "[Orders]
      ------------------------------------
      RecordId            | Title  | Count
      ------------------------------------
      recaaaaaaaaaaaaaaaa | Widget | 7
      ------------------------------------"
    `);
  });
});
