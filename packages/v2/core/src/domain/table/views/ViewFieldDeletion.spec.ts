import { describe, expect, it } from 'vitest';

import { BaseId } from '../../base/BaseId';
import { Table } from '../Table';
import { TableId } from '../TableId';
import { TableName } from '../TableName';
import { FieldId } from '../fields/FieldId';
import { FieldName } from '../fields/FieldName';
import { SingleLineTextField } from '../fields/types/SingleLineTextField';
import { GridView } from './types/GridView';
import { ViewColumnMeta } from './ViewColumnMeta';
import { ViewId } from './ViewId';
import { ViewName } from './ViewName';
import { ViewQueryDefaults } from './ViewQueryDefaults';

describe('View.onFieldDeleted', () => {
  it('updates column order and query defaults when a field is deleted', () => {
    const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
    const tableId = TableId.create(`tbl${'a'.repeat(16)}`)._unsafeUnwrap();
    const viewId = ViewId.create(`viw${'a'.repeat(16)}`)._unsafeUnwrap();
    const titleFieldId = FieldId.create(`fld${'a'.repeat(16)}`)._unsafeUnwrap();
    const statusFieldId = FieldId.create(`fld${'b'.repeat(16)}`)._unsafeUnwrap();
    const ownerFieldId = FieldId.create(`fld${'c'.repeat(16)}`)._unsafeUnwrap();

    const titleField = SingleLineTextField.create({
      id: titleFieldId,
      name: FieldName.create('Title')._unsafeUnwrap(),
    })._unsafeUnwrap();
    const statusField = SingleLineTextField.create({
      id: statusFieldId,
      name: FieldName.create('Status')._unsafeUnwrap(),
    })._unsafeUnwrap();
    const ownerField = SingleLineTextField.create({
      id: ownerFieldId,
      name: FieldName.create('Owner')._unsafeUnwrap(),
    })._unsafeUnwrap();

    const view = GridView.create({
      id: viewId,
      name: ViewName.create('Grid')._unsafeUnwrap(),
    })._unsafeUnwrap();
    view
      .setColumnMeta(
        ViewColumnMeta.create({
          [titleFieldId.toString()]: { order: 0 },
          [statusFieldId.toString()]: { order: 1 },
          [ownerFieldId.toString()]: { order: 2 },
        })._unsafeUnwrap()
      )
      ._unsafeUnwrap();
    view
      .setQueryDefaults(
        ViewQueryDefaults.create({
          filter: {
            conjunction: 'and',
            items: [{ fieldId: statusFieldId.toString(), operator: 'is', value: 'open' }],
          },
          sort: [
            { fieldId: statusFieldId.toString(), order: 'asc' },
            { fieldId: ownerFieldId.toString(), order: 'desc' },
          ],
          group: [{ fieldId: statusFieldId.toString(), order: 'asc' }],
          manualSort: false,
        })._unsafeUnwrap()
      )
      ._unsafeUnwrap();

    const previousTable = Table.rehydrate({
      id: tableId,
      baseId,
      name: TableName.create('Tasks')._unsafeUnwrap(),
      fields: [titleField, statusField, ownerField],
      views: [view],
      primaryFieldId: titleFieldId,
    })._unsafeUnwrap();

    const currentTable = previousTable.removeField(statusFieldId)._unsafeUnwrap();
    const currentView = currentTable.getView(viewId)._unsafeUnwrap();

    const update = currentView
      .onFieldDeleted(statusField, {
        table: currentTable,
        sourceTable: currentTable,
        previousSourceTable: previousTable,
      })
      ._unsafeUnwrap();
    expect(update).toBeDefined();
    if (!update) return;

    const nextMeta = update.columnMeta?.toDto();
    expect(nextMeta?.[statusFieldId.toString()]).toBeUndefined();
    expect(nextMeta?.[ownerFieldId.toString()]?.order).toBe(1);

    const nextQueryDefaults = update.queryDefaults?.toDto();
    expect(nextQueryDefaults?.filter).toBeNull();
    expect(nextQueryDefaults?.sort).toEqual([{ fieldId: ownerFieldId.toString(), order: 'desc' }]);
    expect(nextQueryDefaults?.group).toBeUndefined();
    expect(nextQueryDefaults?.manualSort).toBe(false);
  });
});
