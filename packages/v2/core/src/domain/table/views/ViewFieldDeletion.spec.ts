import { describe, expect, it } from 'vitest';

import { BaseId } from '../../base/BaseId';
import { FieldId } from '../fields/FieldId';
import { FieldName } from '../fields/FieldName';
import { SingleLineTextField } from '../fields/types/SingleLineTextField';
import { Table } from '../Table';
import { TableId } from '../TableId';
import { TableName } from '../TableName';
import { GridView } from './types/GridView';
import { ViewColumnMeta } from './ViewColumnMeta';
import { ViewId } from './ViewId';
import { ViewName } from './ViewName';
import { ViewQueryDefaults } from './ViewQueryDefaults';

describe('View.onFieldDeleted', () => {
  it('moves a frozen boundary to the nearest surviving predecessor after a bulk delete', () => {
    const baseId = BaseId.create(`bse${'z'.repeat(16)}`)._unsafeUnwrap();
    const tableId = TableId.create(`tbl${'z'.repeat(16)}`)._unsafeUnwrap();
    const viewId = ViewId.create(`viw${'z'.repeat(16)}`)._unsafeUnwrap();
    const firstFieldId = FieldId.create(`fld${'x'.repeat(16)}`)._unsafeUnwrap();
    const middleFieldId = FieldId.create(`fld${'y'.repeat(16)}`)._unsafeUnwrap();
    const frozenFieldId = FieldId.create(`fld${'z'.repeat(16)}`)._unsafeUnwrap();

    const fields = [
      SingleLineTextField.create({
        id: firstFieldId,
        name: FieldName.create('First')._unsafeUnwrap(),
      })._unsafeUnwrap(),
      SingleLineTextField.create({
        id: middleFieldId,
        name: FieldName.create('Middle')._unsafeUnwrap(),
      })._unsafeUnwrap(),
      SingleLineTextField.create({
        id: frozenFieldId,
        name: FieldName.create('Frozen')._unsafeUnwrap(),
      })._unsafeUnwrap(),
    ];
    const view = GridView.create({
      id: viewId,
      name: ViewName.create('Grid')._unsafeUnwrap(),
    })._unsafeUnwrap();
    view
      .setColumnMeta(
        ViewColumnMeta.create({
          [firstFieldId.toString()]: { order: 0 },
          [middleFieldId.toString()]: { order: 1 },
          [frozenFieldId.toString()]: { order: 2 },
        })._unsafeUnwrap()
      )
      ._unsafeUnwrap();
    view.setQueryDefaults(ViewQueryDefaults.create({})._unsafeUnwrap())._unsafeUnwrap();
    const optionsResult = view.setOptions({ frozenFieldId: frozenFieldId.toString() });
    expect(optionsResult.isOk()).toBe(true);
    if (optionsResult.isErr()) throw new Error(optionsResult.error.message);

    const previousTable = Table.rehydrate({
      id: tableId,
      baseId,
      name: TableName.create('Tasks')._unsafeUnwrap(),
      fields,
      views: [view],
      primaryFieldId: firstFieldId,
    })._unsafeUnwrap();
    const currentTable = Table.rehydrate({
      id: tableId,
      baseId,
      name: TableName.create('Tasks')._unsafeUnwrap(),
      fields: [fields[0]],
      views: [view],
      primaryFieldId: firstFieldId,
    })._unsafeUnwrap();
    const currentView = currentTable.getView(viewId)._unsafeUnwrap();

    const update = currentView
      .onFieldDeleted(fields[2], {
        table: currentTable,
        sourceTable: currentTable,
        previousSourceTable: previousTable,
      })
      ._unsafeUnwrap();

    expect(update?.options?.nextOptions).toEqual({ frozenFieldId: firstFieldId.toString() });
  });

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

  it('normalizes manualSort to false when sort survives deletion but legacy payload omitted it', () => {
    const baseId = BaseId.create(`bse${'d'.repeat(16)}`)._unsafeUnwrap();
    const tableId = TableId.create(`tbl${'d'.repeat(16)}`)._unsafeUnwrap();
    const viewId = ViewId.create(`viw${'d'.repeat(16)}`)._unsafeUnwrap();
    const amountFieldId = FieldId.create(`fld${'d'.repeat(16)}`)._unsafeUnwrap();
    const statusFieldId = FieldId.create(`fld${'e'.repeat(16)}`)._unsafeUnwrap();
    const ownerFieldId = FieldId.create(`fld${'f'.repeat(16)}`)._unsafeUnwrap();

    const amountField = SingleLineTextField.create({
      id: amountFieldId,
      name: FieldName.create('Amount')._unsafeUnwrap(),
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
          [amountFieldId.toString()]: { order: 0 },
          [statusFieldId.toString()]: { order: 1 },
          [ownerFieldId.toString()]: { order: 2 },
        })._unsafeUnwrap()
      )
      ._unsafeUnwrap();
    view
      .setQueryDefaults(
        ViewQueryDefaults.create(
          {
            filter: {
              fieldId: ownerFieldId.toString(),
              operator: 'isAnyOf',
              value: ['alpha'],
            },
            sort: [
              { fieldId: amountFieldId.toString(), order: 'asc' },
              { fieldId: statusFieldId.toString(), order: 'asc' },
            ],
          },
          {
            sourceFilter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: ownerFieldId.toString(),
                  operator: 'IN',
                  isSymbol: true,
                  value: 'alpha',
                },
              ],
            },
          }
        )._unsafeUnwrap()
      )
      ._unsafeUnwrap();

    const previousTable = Table.rehydrate({
      id: tableId,
      baseId,
      name: TableName.create('Tasks')._unsafeUnwrap(),
      fields: [amountField, statusField, ownerField],
      views: [view],
      primaryFieldId: ownerFieldId,
    })._unsafeUnwrap();

    const currentTable = previousTable.removeField(amountFieldId)._unsafeUnwrap();
    const currentView = currentTable.getView(viewId)._unsafeUnwrap();

    const update = currentView
      .onFieldDeleted(amountField, {
        table: currentTable,
        sourceTable: currentTable,
        previousSourceTable: previousTable,
      })
      ._unsafeUnwrap();

    expect(update?.queryDefaults?.toDto()).toEqual({
      filter: {
        conjunction: 'and',
        items: [
          {
            fieldId: ownerFieldId.toString(),
            operator: 'isAnyOf',
            value: ['alpha'],
          },
        ],
      },
      sort: [{ fieldId: statusFieldId.toString(), order: 'asc' }],
      manualSort: false,
    });
    expect(update?.queryDefaults?.sourceFilter()).toEqual({
      conjunction: 'and',
      filterSet: [
        {
          fieldId: ownerFieldId.toString(),
          operator: 'IN',
          isSymbol: true,
          value: 'alpha',
        },
      ],
    });
  });

  it('does not report a query-default change when deleting a field unrelated to the query', () => {
    const baseId = BaseId.create(`bse${'g'.repeat(16)}`)._unsafeUnwrap();
    const tableId = TableId.create(`tbl${'g'.repeat(16)}`)._unsafeUnwrap();
    const viewId = ViewId.create(`viw${'g'.repeat(16)}`)._unsafeUnwrap();
    const queriedFieldId = FieldId.create(`fld${'g'.repeat(16)}`)._unsafeUnwrap();
    const deletedFieldId = FieldId.create(`fld${'h'.repeat(16)}`)._unsafeUnwrap();
    const queriedField = SingleLineTextField.create({
      id: queriedFieldId,
      name: FieldName.create('Queried')._unsafeUnwrap(),
    })._unsafeUnwrap();
    const deletedField = SingleLineTextField.create({
      id: deletedFieldId,
      name: FieldName.create('Unrelated')._unsafeUnwrap(),
    })._unsafeUnwrap();
    const sourceFilter = {
      conjunction: 'and' as const,
      filterSet: [
        {
          fieldId: queriedFieldId.toString(),
          operator: '=' as const,
          isSymbol: true as const,
          value: 'alpha',
        },
      ],
    };
    const view = GridView.create({
      id: viewId,
      name: ViewName.create('Grid')._unsafeUnwrap(),
    })._unsafeUnwrap();
    view
      .setColumnMeta(
        ViewColumnMeta.create({
          [queriedFieldId.toString()]: { order: 0 },
          [deletedFieldId.toString()]: { order: 1 },
        })._unsafeUnwrap()
      )
      ._unsafeUnwrap();
    view
      .setQueryDefaults(
        ViewQueryDefaults.create(
          {
            filter: {
              fieldId: queriedFieldId.toString(),
              operator: 'is',
              value: 'alpha',
            },
          },
          { sourceFilter }
        )._unsafeUnwrap()
      )
      ._unsafeUnwrap();

    const previousTable = Table.rehydrate({
      id: tableId,
      baseId,
      name: TableName.create('Tasks')._unsafeUnwrap(),
      fields: [queriedField, deletedField],
      views: [view],
      primaryFieldId: queriedFieldId,
    })._unsafeUnwrap();
    const currentTable = previousTable.removeField(deletedFieldId)._unsafeUnwrap();
    const currentView = currentTable.getView(viewId)._unsafeUnwrap();

    const update = currentView
      .onFieldDeleted(deletedField, {
        table: currentTable,
        sourceTable: currentTable,
        previousSourceTable: previousTable,
      })
      ._unsafeUnwrap();

    expect(update).toBeUndefined();
    expect(currentView.queryDefaults()._unsafeUnwrap().sourceFilter()).toEqual(sourceFilter);
  });
});
