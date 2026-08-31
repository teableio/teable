import { describe, expect, it } from 'vitest';

import { BaseId } from '../../base/BaseId';
import { ViewSortUpdated } from '../events/ViewSortUpdated';
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
    .withName(TableName.create('Sort views')._unsafeUnwrap());
  builder.field().singleLineText().withName(FieldName.create('Name')._unsafeUnwrap()).done();
  builder.field().number().withName(FieldName.create('Amount')._unsafeUnwrap()).done();
  builder.field().button().withName(FieldName.create('Action')._unsafeUnwrap()).done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

describe('Table.updateViewSort', () => {
  it('updates multiple sort items through one focused aggregate spec and event', () => {
    const table = buildTable();
    const viewId = table.views()[0]!.id();
    const sort = {
      sortObjs: [
        { fieldId: table.getFields()[0]!.id().toString(), order: 'asc' as const },
        { fieldId: table.getFields()[1]!.id().toString(), order: 'desc' as const },
      ],
      manualSort: false,
    };

    const result = table.updateViewSort(viewId, sort)._unsafeUnwrap();

    expect(result.previousSort).toBeNull();
    expect(result.nextSort).toEqual(sort);
    expect(result.nextQueryDefaults.sort()).toEqual(sort.sortObjs);
    expect(result.nextQueryDefaults.manualSort()).toBe(false);
    expect(result.updateResult?.mutateSpec).toBeInstanceOf(TableUpdateViewQueryDefaultsSpec);
    const [event] = result.updateResult?.table.pullDomainEvents() ?? [];
    expect(event).toBeInstanceOf(ViewSortUpdated);
    expect(event).toMatchObject({ viewId, previousSort: null, nextSort: sort });
  });

  it('preserves empty, manual, identical no-op, and clear branches', () => {
    const table = buildTable();
    const viewId = table.views()[0]!.id();
    const emptySort = { sortObjs: [] };
    const empty = table.updateViewSort(viewId, emptySort)._unsafeUnwrap();
    expect(empty.nextQueryDefaults.sort()).toEqual([]);
    expect(empty.nextSort).toEqual(emptySort);

    const manual = empty
      .updateResult!.table.updateViewSort(viewId, { sortObjs: [], manualSort: true })
      ._unsafeUnwrap();
    expect(manual.nextQueryDefaults.manualSort()).toBe(true);
    expect(
      manual
        .updateResult!.table.updateViewSort(viewId, { sortObjs: [], manualSort: true })
        ._unsafeUnwrap().updateResult
    ).toBeUndefined();

    const cleared = manual.updateResult!.table.updateViewSort(viewId, null)._unsafeUnwrap();
    expect(cleared.nextQueryDefaults.sort()).toBeUndefined();
    expect(cleared.nextQueryDefaults.manualSort()).toBeUndefined();
    expect(cleared.nextSort).toBeNull();
  });

  it('preserves duplicate sort items accepted by the public contract', () => {
    const table = buildTable();
    const fieldId = table.getFields()[0]!.id().toString();
    const sort = {
      sortObjs: [
        { fieldId, order: 'asc' as const },
        { fieldId, order: 'desc' as const },
      ],
    };
    expect(table.updateViewSort(table.views()[0]!.id(), sort)._unsafeUnwrap().nextSort).toEqual(
      sort
    );
  });

  it('rejects missing aggregate children, missing fields, Button fields, and invalid input', () => {
    const table = buildTable();
    const viewId = table.views()[0]!.id();
    expect(
      table
        .updateViewSort(ViewId.create(`viw${'z'.repeat(16)}`)._unsafeUnwrap(), null)
        ._unsafeUnwrapErr().code
    ).toBe('view.not_found');
    expect(
      table
        .updateViewSort(viewId, {
          sortObjs: [{ fieldId: `fld${'z'.repeat(16)}`, order: 'asc' }],
        })
        ._unsafeUnwrapErr().code
    ).toBe('field.not_found');
    expect(
      table
        .updateViewSort(viewId, {
          sortObjs: [{ fieldId: table.getFields()[2]!.id().toString(), order: 'desc' }],
        })
        ._unsafeUnwrapErr().code
    ).toBe('view.sort_unsupported_field_type');
    expect(
      table.updateViewSort(viewId, { sortObjs: [{ fieldId: 'bad', order: 'up' }] }).isErr()
    ).toBe(true);
  });
});
