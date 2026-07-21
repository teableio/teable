import {
  BaseId,
  DbFieldName,
  FieldId,
  FieldName,
  Table,
  TableId,
  TableName,
  ViewName,
} from '@teable/v2-core';
import { describe, expect, it } from 'vitest';

import { buildTableSearchVectorDefinition } from './searchVectorDefinition';

const makeTable = (): Table => {
  const builder = Table.builder()
    .withId(TableId.create('tbl0000000000000001')._unsafeUnwrap())
    .withBaseId(BaseId.create('bse0000000000000001')._unsafeUnwrap())
    .withName(TableName.create('Orders')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withId(FieldId.create('fld0000000000000001')._unsafeUnwrap())
    .withName(FieldName.create('Order number')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .longText()
    .withId(FieldId.create('fld0000000000000002')._unsafeUnwrap())
    .withName(FieldName.create('Notes')._unsafeUnwrap())
    .done();
  builder
    .field()
    .checkbox()
    .withId(FieldId.create('fld0000000000000003')._unsafeUnwrap())
    .withName(FieldName.create('Done')._unsafeUnwrap())
    .done();
  builder.view().grid().withName(ViewName.create('Grid')._unsafeUnwrap()).done();

  const table = builder.build()._unsafeUnwrap();
  table.getFields()[0]?.setDbFieldName(DbFieldName.rehydrate('order_no')._unsafeUnwrap());
  table.getFields()[1]?.setDbFieldName(DbFieldName.rehydrate('notes')._unsafeUnwrap());
  table.getFields()[2]?.setDbFieldName(DbFieldName.rehydrate('done')._unsafeUnwrap());
  return table;
};

describe('buildTableSearchVectorDefinition', () => {
  it('aggregates field visitor decisions into one deterministic table definition', () => {
    const definition = buildTableSearchVectorDefinition(makeTable(), {
      languageConfig: 'simple',
    })._unsafeUnwrap();

    expect(definition).toMatchObject({
      tableId: 'tbl0000000000000001',
      languageConfig: 'simple',
      scope: 'all_fields',
      accessPath: 'generated_tsvector',
      indexKind: 'gin_tsvector',
      fields: [
        { fieldId: 'fld0000000000000001', fieldDbName: 'order_no' },
        { fieldId: 'fld0000000000000002', fieldDbName: 'notes' },
      ],
      skippedFields: [
        { fieldId: 'fld0000000000000003', skippedReason: 'unsupported_search_field_type' },
      ],
    });
    expect(definition.definitionKey).toBe(
      'tbl0000000000000001:simple:fld0000000000000001=order_no,fld0000000000000002=notes'
    );
  });

  it('uses selected field ids without accepting physical column names from callers', () => {
    const definition = buildTableSearchVectorDefinition(makeTable(), {
      languageConfig: 'english',
      fieldIds: ['fld0000000000000002'],
    })._unsafeUnwrap();

    expect(definition.scope).toBe('selected_fields');
    expect(definition.fields).toEqual([
      expect.objectContaining({ fieldId: 'fld0000000000000002', fieldDbName: 'notes' }),
    ]);
  });
});
