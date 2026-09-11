import { describe, expect, it } from 'vitest';

import { DefaultTableMapper } from '../../ports/mappers/defaults/DefaultTableMapper';
import type { ITablePersistenceDTO } from '../../ports/mappers/TableMapper';
import { FieldName } from './fields/FieldName';
import { isTableSearchIndex, type ITableSearchIndex } from './ITableSearchIndex';
import { TableUpdateViewOptionsSpec } from './specs/TableUpdateViewOptionsSpec';
import { TableName } from './TableName';

const mapper = new DefaultTableMapper();
const snapshot: ITableSearchIndex = {
  version: 1,
  dbTableName: 'bseaaaaaaaaaaaaaaaa.tblaaaaaaaaaaaaaaaa',
  generatedColumnName: '__search_document',
  indexName: 'idx_search_document',
  provider: 'pg_trgm',
  searchScope: 'all_fields',
  definitionKey: 'validated-definition',
  indexUsable: false,
  fields: [
    {
      fieldId: 'fldaaaaaaaaaaaaaaaa',
      fieldDbName: 'title',
      textProjection: { kind: 'plain' },
    },
  ],
};
const dto: ITablePersistenceDTO = {
  id: 'tblaaaaaaaaaaaaaaaa',
  baseId: 'bseaaaaaaaaaaaaaaaa',
  name: 'Search table',
  dbTableName: snapshot.dbTableName,
  searchIndex: snapshot,
  primaryFieldId: 'fldaaaaaaaaaaaaaaaa',
  fields: [
    {
      id: 'fldaaaaaaaaaaaaaaaa',
      name: 'Title',
      type: 'singleLineText',
      dbFieldName: 'title',
    },
  ],
  views: [{ id: 'viwaaaaaaaaaaaaaaaa', name: 'Grid', type: 'grid', columnMeta: {} }],
};

describe('Table search index serving state', () => {
  it('preserves configured fallback through clone, rename, and field updates', () => {
    const table = mapper.toDomain(dto)._unsafeUnwrap();
    const cloned = table.clone(mapper)._unsafeUnwrap();
    const renamed = cloned.rename(TableName.create('Renamed')._unsafeUnwrap())._unsafeUnwrap();
    const updated = renamed
      .updateFieldName(renamed.primaryFieldId(), FieldName.create('Renamed title')._unsafeUnwrap())
      ._unsafeUnwrap();

    expect(updated.searchIndex()).toEqual(snapshot);
    expect(mapper.toDTO(updated)._unsafeUnwrap().searchIndex).toEqual(snapshot);
  });

  it('retains an empty configured fallback instead of re-enrolling current table fields', () => {
    const fallback: ITableSearchIndex = { ...snapshot, searchScope: 'selected_fields', fields: [] };
    const table = mapper.toDomain({ ...dto, searchIndex: fallback })._unsafeUnwrap();

    expect(isTableSearchIndex(fallback)).toBe(true);
    expect(table.clone(mapper)._unsafeUnwrap().searchIndex()).toEqual(fallback);
  });

  it('preserves serving state when view options reconstruct the aggregate', () => {
    const table = mapper.toDomain(dto)._unsafeUnwrap();
    const view = table.defaultView()._unsafeUnwrap();
    const updated = TableUpdateViewOptionsSpec.create({
      viewId: view.id(),
      previousOptions: view.options(),
      nextOptions: { rowHeight: 'tall' },
    })
      .mutate(table)
      ._unsafeUnwrap();

    expect(updated.searchIndex()).toEqual(snapshot);
    expect(updated.defaultView()._unsafeUnwrap().options()).toEqual({ rowHeight: 'tall' });
  });

  it('never carries serving state into a duplicate or a different physical table', () => {
    const table = mapper.toDomain(dto)._unsafeUnwrap();
    const duplicated = table
      .duplicate({ mapper, newName: TableName.create('Copy')._unsafeUnwrap() })
      ._unsafeUnwrap();

    expect(duplicated.table.searchIndex()).toBeUndefined();
    expect(
      mapper
        .toDomain({ ...dto, dbTableName: 'bseaaaaaaaaaaaaaaaa.other' })
        ._unsafeUnwrap()
        .searchIndex()
    ).toBeUndefined();
    expect(
      mapper
        .toDomain({ ...dto, dbTableName: undefined })
        ._unsafeUnwrap()
        .searchIndex()
    ).toBeUndefined();
  });

  it.each([
    null,
    {},
    { ...snapshot, version: 2 },
    { ...snapshot, indexUsable: 'true' },
    { ...snapshot, indexUsable: true, fields: [] },
    { ...snapshot, fields: [{ ...snapshot.fields[0], textProjection: { kind: 'date_range' } }] },
    {
      ...snapshot,
      fields: [
        { ...snapshot.fields[0], textProjection: { kind: 'rounded_number', precision: -1 } },
      ],
    },
  ])('treats invalid persisted state as absent without rejecting the table: %j', (invalid) => {
    const persisted: ITablePersistenceDTO = JSON.parse(
      JSON.stringify({ ...dto, searchIndex: invalid })
    );
    expect(isTableSearchIndex(invalid)).toBe(false);
    expect(mapper.toDomain(persisted)._unsafeUnwrap().searchIndex()).toBeUndefined();
  });
});
