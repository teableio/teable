import { describe, expect, it } from 'vitest';

import { BaseId } from '../../base/BaseId';
import { ViewFilterUpdated } from '../events/ViewFilterUpdated';
import { FieldName } from '../fields/FieldName';
import { TableUpdateViewQueryDefaultsSpec } from '../specs/TableUpdateViewQueryDefaultsSpec';
import { Table } from '../Table';
import { TableId } from '../TableId';
import { TableName } from '../TableName';
import { ViewId } from '../views/ViewId';

const buildTable = (): Table => {
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
    .withId(TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Filter views')._unsafeUnwrap());
  builder.field().singleLineText().withName(FieldName.create('Name')._unsafeUnwrap()).done();
  builder.field().number().withName(FieldName.create('Amount')._unsafeUnwrap()).done();
  builder.field().date().withName(FieldName.create('Due')._unsafeUnwrap()).done();
  builder.field().button().withName(FieldName.create('Action')._unsafeUnwrap()).done();
  builder.field().multipleSelect().withName(FieldName.create('Tags')._unsafeUnwrap()).done();
  builder
    .field()
    .singleLineText()
    .withName(FieldName.create('Product name')._unsafeUnwrap())
    .done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

describe('Table.updateViewFilter', () => {
  it('preserves a rich public filter and returns a focused aggregate spec and event', () => {
    const table = buildTable();
    const [name, amount, due] = table.getFields();
    const viewId = table.views()[0]!.id();
    const filter = {
      conjunction: 'and' as const,
      filterSet: [
        {
          fieldId: name!.id().toString(),
          operator: '=' as const,
          isSymbol: true as const,
          value: 'alpha',
        },
        {
          conjunction: 'or' as const,
          filterSet: [
            {
              fieldId: amount!.id().toString(),
              operator: 'isGreater' as const,
              value: 3,
            },
            {
              fieldId: name!.id().toString(),
              operator: 'is' as const,
              value: {
                type: 'field' as const,
                fieldId: name!.id().toString(),
                tableId: table.id().toString(),
              },
            },
          ],
        },
        {
          fieldId: due!.id().toString(),
          operator: 'is' as const,
          value: {
            mode: 'dateRange' as const,
            exactDate: '2026-07-01T00:00:00.000Z',
            exactDateEnd: '2026-07-31T23:59:59.000Z',
            timeZone: 'UTC',
          },
        },
      ],
    };

    const result = table.updateViewFilter(viewId, filter)._unsafeUnwrap();

    expect(result.nextQueryDefaults.sourceFilter()).toEqual(filter);
    expect(result.updateResult?.mutateSpec).toBeInstanceOf(TableUpdateViewQueryDefaultsSpec);
    const [event] = result.updateResult?.table.pullDomainEvents() ?? [];
    expect(event).toBeInstanceOf(ViewFilterUpdated);
    expect(event).toMatchObject({
      viewId,
      previousFilter: undefined,
      nextFilter: filter,
    });
    expect(result.updateResult?.table).toBeDefined();
  });

  it('supports empty, incomplete, null, and identical no-op branches', () => {
    const table = buildTable();
    const viewId = table.views()[0]!.id();
    const empty = table
      .updateViewFilter(viewId, { conjunction: 'and', filterSet: [] })
      ._unsafeUnwrap();
    const incompleteFilter = {
      conjunction: 'and' as const,
      filterSet: [
        {
          fieldId: table.getFields()[0]!.id().toString(),
          operator: 'isNot' as const,
          value: null,
        },
      ],
    };
    const incomplete = empty
      .updateResult!.table.updateViewFilter(viewId, incompleteFilter)
      ._unsafeUnwrap();
    expect(incomplete.nextQueryDefaults.sourceFilter()).toEqual(incompleteFilter);
    expect(
      incomplete.updateResult!.table.updateViewFilter(viewId, incompleteFilter)._unsafeUnwrap()
        .updateResult
    ).toBeUndefined();
    const cleared = incomplete.updateResult!.table.updateViewFilter(viewId, null)._unsafeUnwrap();
    expect(cleared.nextQueryDefaults.sourceFilter()).toBeNull();
    expect(cleared.nextQueryDefaults.filter()).toBeNull();
  });

  it('preserves incomplete list conditions in the source filter', () => {
    const table = buildTable();
    const viewId = table.views()[0]!.id();
    const nameField = table.getFields().find((field) => field.name().toString() === 'Name')!;
    const tagsField = table.getFields().find((field) => field.name().toString() === 'Tags')!;
    const productField = table
      .getFields()
      .find((field) => field.name().toString() === 'Product name')!;
    const filter = {
      conjunction: 'and' as const,
      filterSet: [
        {
          fieldId: nameField.id().toString(),
          operator: 'is' as const,
          value: 'kept',
        },
        {
          fieldId: tagsField.id().toString(),
          operator: 'hasAnyOf' as const,
          value: null,
        },
        {
          fieldId: productField.id().toString(),
          operator: 'is' as const,
          value: null,
        },
      ],
    };

    const result = table.updateViewFilter(viewId, filter)._unsafeUnwrap();

    expect(result.nextQueryDefaults.sourceFilter()).toEqual(filter);
    expect(result.nextQueryDefaults.filter()).toEqual({
      conjunction: 'and',
      items: [
        { fieldId: nameField.id().toString(), operator: 'is', value: 'kept' },
        { fieldId: productField.id().toString(), operator: 'is', value: null },
      ],
    });
  });

  it('normalizes an all-incomplete list source filter to a null canonical filter', () => {
    const table = buildTable();
    const viewId = table.views()[0]!.id();
    const tagsField = table.getFields().find((field) => field.name().toString() === 'Tags')!;
    const filter = {
      conjunction: 'and' as const,
      filterSet: [
        {
          fieldId: tagsField.id().toString(),
          operator: 'hasAnyOf' as const,
          value: null,
        },
      ],
    };

    const result = table.updateViewFilter(viewId, filter)._unsafeUnwrap();

    expect(result.nextQueryDefaults.sourceFilter()).toEqual(filter);
    expect(result.nextQueryDefaults.filter()).toBeNull();
  });

  it('rejects missing children, unsupported fields, and incompatible operators', () => {
    const table = buildTable();
    const viewId = table.views()[0]!.id();
    expect(
      table
        .updateViewFilter(ViewId.create(`viw${'z'.repeat(16)}`)._unsafeUnwrap(), null)
        ._unsafeUnwrapErr().code
    ).toBe('view.not_found');
    expect(
      table
        .updateViewFilter(viewId, {
          conjunction: 'and',
          filterSet: [{ fieldId: `fld${'z'.repeat(16)}`, operator: 'is', value: 'missing' }],
        })
        ._unsafeUnwrapErr().code
    ).toBe('field.not_found');
    expect(
      table
        .updateViewFilter(viewId, {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: table.getFields()[3]!.id().toString(),
              operator: 'isEmpty',
              value: null,
            },
          ],
        })
        ._unsafeUnwrapErr().code
    ).toBe('view.filter_unsupported_field_type');
    expect(
      table
        .updateViewFilter(viewId, {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: table.getFields()[1]!.id().toString(),
              operator: 'contains',
              value: 'three',
            },
          ],
        })
        .isErr()
    ).toBe(true);
  });

  it('rejects field references that claim another Table', () => {
    const table = buildTable();
    const fieldId = table.getFields()[0]!.id().toString();
    const result = table.updateViewFilter(table.views()[0]!.id(), {
      conjunction: 'and',
      filterSet: [
        {
          fieldId,
          operator: 'is',
          value: { type: 'field', fieldId, tableId: `tbl${'z'.repeat(16)}` },
        },
      ],
    });
    expect(result._unsafeUnwrapErr().code).toBe('view.filter_field_table_mismatch');
  });
});
