import { describe, expect, it } from 'vitest';

import { BaseId } from '../domain/base/BaseId';
import { FieldName } from '../domain/table/fields/FieldName';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import { mergeRecordFiltersWithAnd, RecordSearch } from './RecordSearch';

const buildTable = () => {
  const baseId = BaseId.create(`bse${'s'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'s'.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create('Record Search Test')._unsafeUnwrap();

  const builder = Table.builder().withId(tableId).withBaseId(baseId).withName(tableName);
  builder
    .field()
    .singleLineText()
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  builder.field().longText().withName(FieldName.create('Notes')._unsafeUnwrap()).done();
  builder.field().date().withName(FieldName.create('Due')._unsafeUnwrap()).done();
  builder.field().button().withName(FieldName.create('Action')._unsafeUnwrap()).done();
  builder.view().defaultGrid().done();

  return builder.build()._unsafeUnwrap();
};

describe('RecordSearch', () => {
  it('resolves field keys to concrete table fields', () => {
    const table = buildTable();
    const titleField = table.getFields()[0]!;

    const search = RecordSearch.fromTuple([
      'target',
      `${titleField.id().toString()},${titleField.name().toString()}`,
    ]);
    const resolvedFields = search.resolveFields(table)._unsafeUnwrap();

    expect(resolvedFields.map((field) => field.id().toString())).toEqual([
      titleField.id().toString(),
    ]);
  });

  it('builds hide-not-match filter from visible searchable fields only', () => {
    const table = buildTable();
    const titleField = table.getFields()[0]!;
    const notesField = table.getFields()[1]!;

    const search = RecordSearch.fromTuple(['target', '', true]);
    const filter = search
      .buildHideNotMatchFilter(table, {
        visibleFieldIds: [titleField.id(), notesField.id()],
      })
      ._unsafeUnwrap();

    expect(filter).toEqual({
      conjunction: 'or',
      items: [
        { fieldId: titleField.id().toString(), operator: 'contains', value: 'target' },
        { fieldId: notesField.id().toString(), operator: 'contains', value: 'target' },
      ],
    });
  });

  it('treats an explicit empty visible field list as no searchable fields', () => {
    const table = buildTable();
    const search = RecordSearch.fromTuple(['target', '', true]);

    const resolvedFields = search.resolveFields(table, {
      visibleFieldIds: [],
    });

    expect(resolvedFields._unsafeUnwrap()).toEqual([]);
  });

  it('merges search filters into existing filters with AND semantics', () => {
    const merged = mergeRecordFiltersWithAnd(
      { fieldId: 'fldFilter', operator: 'is', value: 'A' },
      { fieldId: 'fldSearch', operator: 'contains', value: 'target' }
    );

    expect(merged).toEqual({
      conjunction: 'and',
      items: [
        { fieldId: 'fldFilter', operator: 'is', value: 'A' },
        { fieldId: 'fldSearch', operator: 'contains', value: 'target' },
      ],
    });
  });
});
