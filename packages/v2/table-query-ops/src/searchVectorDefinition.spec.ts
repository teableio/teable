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

import {
  buildTableSearchAccessPathDefinition,
  WIDE_TABLE_ALL_FIELD_DOCUMENT_MIN_FIELD_COUNT,
  WIDE_TABLE_ALL_FIELD_DOCUMENT_MIN_SEARCHABLE_COUNT,
} from './searchVectorDefinition';

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

const fieldIdAt = (n: number) =>
  FieldId.create(`fld${String(n).padStart(16, '0')}`)._unsafeUnwrap();

const makeTableWithCounts = (input: { textCount: number; checkboxCount?: number }): Table => {
  const builder = Table.builder()
    .withId(TableId.create('tbl0000000000000001')._unsafeUnwrap())
    .withBaseId(BaseId.create('bse0000000000000001')._unsafeUnwrap())
    .withName(TableName.create('Wide')._unsafeUnwrap());

  let n = 1;
  for (let i = 0; i < input.textCount; i++) {
    const field = builder
      .field()
      .singleLineText()
      .withId(fieldIdAt(n))
      .withName(FieldName.create(`T${n}`)._unsafeUnwrap());
    if (i === 0) {
      field.primary();
    }
    field.done();
    n += 1;
  }
  for (let i = 0; i < (input.checkboxCount ?? 0); i++) {
    builder
      .field()
      .checkbox()
      .withId(fieldIdAt(n))
      .withName(FieldName.create(`C${n}`)._unsafeUnwrap())
      .done();
    n += 1;
  }
  builder.view().grid().withName(ViewName.create('Grid')._unsafeUnwrap()).done();

  const table = builder.build()._unsafeUnwrap();
  for (const [index, field] of table.getFields().entries()) {
    field.setDbFieldName(DbFieldName.rehydrate(`col_${index}`)._unsafeUnwrap());
  }
  return table;
};

describe('buildTableSearchAccessPathDefinition', () => {
  it('builds a deterministic substring document definition by default', () => {
    const definition = buildTableSearchAccessPathDefinition(makeTable(), {
      provider: 'pg_trgm',
    })._unsafeUnwrap();

    expect(definition).toMatchObject({
      tableId: 'tbl0000000000000001',
      semantics: 'substring',
      provider: 'pg_trgm',
      scope: 'all_fields',
      accessPath: 'generated_text',
      indexKind: 'gin_trgm',
      fields: [
        {
          fieldId: 'fld0000000000000001',
          fieldDbName: 'order_no',
          textProjection: { kind: 'plain' },
        },
        {
          fieldId: 'fld0000000000000002',
          fieldDbName: 'notes',
          textProjection: { kind: 'multiline' },
        },
      ],
      skippedFields: [{ fieldId: 'fld0000000000000003', skippedReason: 'non_text_value' }],
    });
    expect(definition.definitionKey).toBe(
      'tbl0000000000000001:substring:pg_trgm:none:fld0000000000000001=order_no:plain,fld0000000000000002=notes:multiline'
    );
  });

  it('uses selected field ids without accepting physical column names from callers', () => {
    const definition = buildTableSearchAccessPathDefinition(makeTable(), {
      provider: 'pg_bigm',
      fieldIds: ['fld0000000000000002'],
    })._unsafeUnwrap();

    expect(definition.scope).toBe('selected_fields');
    expect(definition.fields).toEqual([
      expect.objectContaining({ fieldId: 'fld0000000000000002', fieldDbName: 'notes' }),
    ]);
  });

  it('keeps lexical tsvector as an explicit non-substring definition', () => {
    const definition = buildTableSearchAccessPathDefinition(makeTable(), {
      semantics: 'lexical',
      provider: 'tsvector',
      languageConfig: 'english',
    })._unsafeUnwrap();

    expect(definition).toMatchObject({
      semantics: 'lexical',
      provider: 'tsvector',
      languageConfig: 'english',
      accessPath: 'generated_tsvector',
      indexKind: 'gin_tsvector',
    });
  });

  it('excludes attachment, number, and select from the substring document', () => {
    const builder = Table.builder()
      .withId(TableId.create('tbl0000000000000001')._unsafeUnwrap())
      .withBaseId(BaseId.create('bse0000000000000001')._unsafeUnwrap())
      .withName(TableName.create('Mixed')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(FieldId.create('fld0000000000000001')._unsafeUnwrap())
      .withName(FieldName.create('Title')._unsafeUnwrap())
      .primary()
      .done();
    builder
      .field()
      .number()
      .withId(FieldId.create('fld0000000000000002')._unsafeUnwrap())
      .withName(FieldName.create('Amount')._unsafeUnwrap())
      .done();
    builder
      .field()
      .attachment()
      .withId(FieldId.create('fld0000000000000003')._unsafeUnwrap())
      .withName(FieldName.create('Files')._unsafeUnwrap())
      .done();
    builder
      .field()
      .singleSelect()
      .withId(FieldId.create('fld0000000000000004')._unsafeUnwrap())
      .withName(FieldName.create('Status')._unsafeUnwrap())
      .done();
    builder.view().grid().withName(ViewName.create('Grid')._unsafeUnwrap()).done();
    const table = builder.build()._unsafeUnwrap();
    for (const [index, field] of table.getFields().entries()) {
      field.setDbFieldName(DbFieldName.rehydrate(`col_${index}`)._unsafeUnwrap());
    }

    const definition = buildTableSearchAccessPathDefinition(table, {
      provider: 'pg_trgm',
    })._unsafeUnwrap();

    expect(definition.fields).toEqual([
      expect.objectContaining({ fieldId: 'fld0000000000000001', fieldType: 'singleLineText' }),
    ]);
    expect(definition.skippedFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldId: 'fld0000000000000002',
          fieldType: 'number',
          included: false,
          skippedReason: 'unsupported_search_field_type',
        }),
        expect.objectContaining({
          fieldId: 'fld0000000000000003',
          fieldType: 'attachment',
          included: false,
          skippedReason: 'unsupported_search_field_type',
        }),
        expect.objectContaining({
          fieldId: 'fld0000000000000004',
          fieldType: 'singleSelect',
          included: false,
          skippedReason: 'unsupported_search_field_type',
        }),
      ])
    );
  });

  it('refuses all-field documents when field count meets the wide-table threshold', () => {
    const table = makeTableWithCounts({
      textCount: 1,
      checkboxCount: WIDE_TABLE_ALL_FIELD_DOCUMENT_MIN_FIELD_COUNT - 1,
    });

    const definition = buildTableSearchAccessPathDefinition(table, {
      provider: 'pg_trgm',
    })._unsafeUnwrap();

    expect(table.getFields()).toHaveLength(WIDE_TABLE_ALL_FIELD_DOCUMENT_MIN_FIELD_COUNT);
    expect(definition.scope).toBe('all_fields');
    expect(definition.accessPath).toBe('none');
    expect(definition.fields).toEqual([]);
    expect(definition.skippedFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldId: 'fld0000000000000001',
          skippedReason: 'wide_table_all_field_document',
        }),
      ])
    );
  });

  it('refuses all-field documents when searchable field count meets the threshold', () => {
    const table = makeTableWithCounts({
      textCount: WIDE_TABLE_ALL_FIELD_DOCUMENT_MIN_SEARCHABLE_COUNT,
    });

    const definition = buildTableSearchAccessPathDefinition(table, {
      provider: 'pg_trgm',
    })._unsafeUnwrap();

    expect(definition.accessPath).toBe('none');
    expect(definition.fields).toEqual([]);
    expect(
      definition.skippedFields.filter(
        (field) => field.skippedReason === 'wide_table_all_field_document'
      )
    ).toHaveLength(WIDE_TABLE_ALL_FIELD_DOCUMENT_MIN_SEARCHABLE_COUNT);
  });

  it('keeps all-field documents below both wide-table thresholds', () => {
    const table = makeTableWithCounts({
      textCount: WIDE_TABLE_ALL_FIELD_DOCUMENT_MIN_SEARCHABLE_COUNT - 1,
    });

    const definition = buildTableSearchAccessPathDefinition(table, {
      provider: 'pg_trgm',
    })._unsafeUnwrap();

    expect(definition.accessPath).toBe('generated_text');
    expect(definition.fields).toHaveLength(WIDE_TABLE_ALL_FIELD_DOCUMENT_MIN_SEARCHABLE_COUNT - 1);
  });

  it('still allows selected-field documents on a wide table', () => {
    const table = makeTableWithCounts({
      textCount: WIDE_TABLE_ALL_FIELD_DOCUMENT_MIN_SEARCHABLE_COUNT,
    });

    const definition = buildTableSearchAccessPathDefinition(table, {
      provider: 'pg_trgm',
      fieldIds: ['fld0000000000000001', 'fld0000000000000002'],
    })._unsafeUnwrap();

    expect(definition.scope).toBe('selected_fields');
    expect(definition.accessPath).toBe('generated_text');
    expect(definition.fields).toHaveLength(2);
  });
});
