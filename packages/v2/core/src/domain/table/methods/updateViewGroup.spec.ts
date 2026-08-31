import { describe, expect, it } from 'vitest';

import { BaseId } from '../../base/BaseId';
import { ViewGroupUpdated } from '../events/ViewGroupUpdated';
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
    .withName(TableName.create('Group views')._unsafeUnwrap());
  builder.field().singleLineText().withName(FieldName.create('Name')._unsafeUnwrap()).done();
  builder.field().number().withName(FieldName.create('Amount')._unsafeUnwrap()).done();
  builder.field().button().withName(FieldName.create('Action')._unsafeUnwrap()).done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

describe('Table.updateViewGroup', () => {
  it('updates multiple group items through one focused aggregate spec and event', () => {
    const table = buildTable();
    const viewId = table.views()[0]!.id();
    const group = [
      { fieldId: table.getFields()[0]!.id().toString(), order: 'asc' as const },
      { fieldId: table.getFields()[1]!.id().toString(), order: 'desc' as const },
    ];

    const result = table.updateViewGroup(viewId, group)._unsafeUnwrap();

    expect(result.previousGroup).toBeNull();
    expect(result.nextGroup).toEqual(group);
    expect(result.nextQueryDefaults.group()).toEqual(group);
    expect(result.updateResult?.mutateSpec).toBeInstanceOf(TableUpdateViewQueryDefaultsSpec);
    const [event] = result.updateResult?.table.pullDomainEvents() ?? [];
    expect(event).toBeInstanceOf(ViewGroupUpdated);
    expect(event).toMatchObject({ viewId, previousGroup: null, nextGroup: group });
  });

  it('preserves empty, identical no-op, and clear branches without changing other defaults', () => {
    const table = buildTable();
    const viewId = table.views()[0]!.id();
    const sorted = table
      .updateViewSort(viewId, {
        sortObjs: [{ fieldId: table.getFields()[1]!.id().toString(), order: 'desc' }],
      })
      ._unsafeUnwrap().updateResult!.table;
    const empty = sorted.updateViewGroup(viewId, [])._unsafeUnwrap();
    expect(empty.nextQueryDefaults.group()).toEqual([]);
    expect(empty.nextQueryDefaults.sort()).toEqual([
      { fieldId: table.getFields()[1]!.id().toString(), order: 'desc' },
    ]);

    const current = empty.updateResult!.table;
    expect(current.updateViewGroup(viewId, [])._unsafeUnwrap().updateResult).toBeUndefined();

    const cleared = current.updateViewGroup(viewId, null)._unsafeUnwrap();
    expect(cleared.nextQueryDefaults.group()).toBeUndefined();
    expect(cleared.nextGroup).toBeNull();
    expect(cleared.nextQueryDefaults.sort()).toEqual([
      { fieldId: table.getFields()[1]!.id().toString(), order: 'desc' },
    ]);
  });

  it('preserves duplicate group items accepted by the public contract', () => {
    const table = buildTable();
    const fieldId = table.getFields()[0]!.id().toString();
    const group = [
      { fieldId, order: 'asc' as const },
      { fieldId, order: 'desc' as const },
    ];

    expect(table.updateViewGroup(table.views()[0]!.id(), group)._unsafeUnwrap().nextGroup).toEqual(
      group
    );
  });

  it('rejects missing aggregate children, missing fields, Button fields, and invalid input', () => {
    const table = buildTable();
    const viewId = table.views()[0]!.id();
    expect(
      table
        .updateViewGroup(ViewId.create(`viw${'z'.repeat(16)}`)._unsafeUnwrap(), null)
        ._unsafeUnwrapErr().code
    ).toBe('view.not_found');
    expect(
      table
        .updateViewGroup(viewId, [{ fieldId: `fld${'z'.repeat(16)}`, order: 'asc' }])
        ._unsafeUnwrapErr().code
    ).toBe('field.not_found');
    expect(
      table
        .updateViewGroup(viewId, [
          { fieldId: table.getFields()[2]!.id().toString(), order: 'desc' },
        ])
        ._unsafeUnwrapErr().code
    ).toBe('view.group_unsupported_field_type');
    expect(table.updateViewGroup(viewId, [{ fieldId: 'bad', order: 'up' }]).isErr()).toBe(true);
  });
});
