import {
  BaseId,
  DbFieldName,
  DbTableName,
  FieldId,
  FieldName,
  Table,
  TableId,
  TableName,
  ViewName,
  type ITableSearchIndex,
} from '@teable/v2-core';
import { describe, expect, it } from 'vitest';

import { resolveTableSearchAccessPath } from './searchAccessPath';

const snapshot: ITableSearchIndex = {
  version: 1,
  dbTableName: 'bse0000000000000001.records',
  generatedColumnName: '__search_document',
  indexName: 'search_document_idx',
  provider: 'pg_trgm',
  searchScope: 'all_fields',
  definitionKey: 'validated-definition',
  indexUsable: true,
  fields: [
    { fieldId: 'fld0000000000000001', fieldDbName: 'title', textProjection: { kind: 'plain' } },
    { fieldId: 'fld0000000000000002', fieldDbName: 'notes', textProjection: { kind: 'multiline' } },
  ],
};

const makeTable = (searchIndex: ITableSearchIndex | undefined, titleDbName = 'title'): Table => {
  const builder = Table.builder()
    .withId(TableId.create('tbl0000000000000001')._unsafeUnwrap())
    .withBaseId(BaseId.create('bse0000000000000001')._unsafeUnwrap())
    .withName(TableName.create('Records')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withId(FieldId.create('fld0000000000000001')._unsafeUnwrap())
    .withName(FieldName.create('Title')._unsafeUnwrap())
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
    .singleLineText()
    .withId(FieldId.create('fld0000000000000003')._unsafeUnwrap())
    .withName(FieldName.create('New field')._unsafeUnwrap())
    .done();
  builder.view().grid().withName(ViewName.create('Grid')._unsafeUnwrap()).done();
  const table = builder.build()._unsafeUnwrap();
  for (const [index, name] of [titleDbName, 'notes', 'new_field'].entries()) {
    table
      .getFields()
      [index]!.setDbFieldName(DbFieldName.rehydrate(name)._unsafeUnwrap())
      ._unsafeUnwrap();
  }
  return Table.rehydrate({
    id: table.id(),
    baseId: table.baseId(),
    name: table.name(),
    fields: table.getFields(),
    views: table.views(),
    primaryFieldId: table.primaryFieldId(),
    dbTableName: DbTableName.rehydrate(snapshot.dbTableName)._unsafeUnwrap(),
    searchIndex,
  })._unsafeUnwrap();
};

const coveredIds = (table: Table): string[] => {
  const path = resolveTableSearchAccessPath(table);
  return path?.kind === 'generated_text' ? path.coveredFieldIds.map((id) => id.toString()) : [];
};

describe('resolveTableSearchAccessPath', () => {
  it('retains saved coverage without enrolling newly searchable fields', () => {
    const table = makeTable(snapshot);
    expect(coveredIds(table)).toEqual(['fld0000000000000001', 'fld0000000000000002']);
    expect(resolveTableSearchAccessPath(table)).toMatchObject({ indexUsable: true });
  });

  it('excludes renamed physical fields and changed canonical projections', () => {
    const table = makeTable({
      ...snapshot,
      fields: [
        snapshot.fields[0]!,
        {
          ...snapshot.fields[1]!,
          textProjection: { kind: 'plain' },
        },
      ],
    });
    expect(coveredIds(table)).toEqual(['fld0000000000000001']);
    const renamed = makeTable(table.searchIndex(), 'renamed_title');
    expect(coveredIds(renamed)).toEqual([]);
    expect(resolveTableSearchAccessPath(renamed)).toMatchObject({ indexUsable: false });
  });

  it('preserves configured fallback scope when an index is unusable', () => {
    const table = makeTable({
      ...snapshot,
      indexUsable: false,
      searchScope: 'selected_fields',
      fields: [snapshot.fields[1]!],
    });
    expect(resolveTableSearchAccessPath(table)).toMatchObject({
      kind: 'generated_text',
      indexUsable: false,
      searchScope: 'selected_fields',
    });
    expect(coveredIds(table)).toEqual(['fld0000000000000002']);
  });

  it('does not serve absent metadata or another physical table snapshot', () => {
    expect(resolveTableSearchAccessPath(makeTable(undefined))).toBeUndefined();
    expect(
      resolveTableSearchAccessPath(makeTable({ ...snapshot, dbTableName: 'other.records' }))
    ).toBeUndefined();
  });
});
