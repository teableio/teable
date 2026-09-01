import { describe, expect, it } from 'vitest';

import { BaseId } from '../../base/BaseId';
import { FieldName } from '../fields/FieldName';
import { Table } from '../Table';
import { TableName } from '../TableName';
import { ViewColumnMeta } from '../views/ViewColumnMeta';
import { ViewName } from '../views/ViewName';
import { ViewOrder } from '../views/ViewOrder';
import { ViewQueryDefaults } from '../views/ViewQueryDefaults';
import { captureViewSnapshot, rehydrateViewSnapshot } from '../views/ViewSnapshot';

const buildTable = () => {
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'s'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Snapshot')._unsafeUnwrap());
  builder.field().singleLineText().withName(FieldName.create('Name')._unsafeUnwrap()).done();
  builder.view().defaultGrid().done();
  builder.view().grid().withName(ViewName.create('Second')._unsafeUnwrap()).done();
  const table = builder.build()._unsafeUnwrap();
  const fieldId = table.primaryFieldId().toString();
  for (const [index, view] of table.views().entries()) {
    view.setColumnMeta(
      ViewColumnMeta.create({ [fieldId]: { order: 0, width: 200 + index } })._unsafeUnwrap()
    );
    view.setQueryDefaults(ViewQueryDefaults.rehydrate({})._unsafeUnwrap());
    view.setOptions({ rowHeight: 'short' });
    view.setOrder(ViewOrder.rehydrate(index)._unsafeUnwrap());
  }
  return table;
};

describe('Table.applyViewSnapshot', () => {
  it('restores changed child state through existing Table mutation specs', () => {
    const table = buildTable();
    const target = table.views()[0]!;
    const snapshot = captureViewSnapshot(target)._unsafeUnwrap();
    const fieldId = table.primaryFieldId().toString();
    const nextView = rehydrateViewSnapshot({
      ...snapshot,
      name: 'Restored name',
      order: 12,
      properties: {
        ...snapshot.properties,
        description: 'Restored description',
        isLocked: true,
      },
      columnMeta: { [fieldId]: { order: 0, width: 420, hidden: true } },
      options: { rowHeight: 'tall' },
    })._unsafeUnwrap();

    const result = table.applyViewSnapshot(nextView)._unsafeUnwrap();
    expect(result.updateResult).toBeDefined();
    const updated = result.updateResult!.table.getView(target.id())._unsafeUnwrap();
    expect(updated.name().toString()).toBe('Restored name');
    expect(updated.description()).toBe('Restored description');
    expect(updated.isLocked()).toBe(true);
    expect(updated.order()._unsafeUnwrap().toNumber()).toBe(12);
    expect(updated.columnMeta()._unsafeUnwrap().toDto()[fieldId]).toEqual({
      order: 0,
      width: 420,
      hidden: true,
    });
    expect(updated.options()).toEqual({ rowHeight: 'tall' });
  });

  it('revives a missing View child with the same identity and full snapshot', () => {
    const table = buildTable();
    const target = table.views()[0]!;
    const snapshot = captureViewSnapshot(target)._unsafeUnwrap();
    const deletedTable = table.deleteView(target.id())._unsafeUnwrap().updateResult.table;
    expect(deletedTable.getView(target.id()).isErr()).toBe(true);

    const snapshotView = rehydrateViewSnapshot(snapshot)._unsafeUnwrap();
    const result = deletedTable.applyViewSnapshot(snapshotView)._unsafeUnwrap();
    const restored = result.updateResult!.table.getView(target.id())._unsafeUnwrap();
    expect(restored.id().equals(target.id())).toBe(true);
    expect(captureViewSnapshot(restored)._unsafeUnwrap()).toEqual(snapshot);
  });

  it('returns no mutation for an identical snapshot', () => {
    const table = buildTable();
    const target = table.views()[0]!;
    const snapshotView = rehydrateViewSnapshot(
      captureViewSnapshot(target)._unsafeUnwrap()
    )._unsafeUnwrap();

    expect(table.applyViewSnapshot(snapshotView)._unsafeUnwrap().updateResult).toBeUndefined();
  });

  it('clears optional description and options when the snapshot omits them', () => {
    const originalTable = buildTable();
    const targetId = originalTable.views()[0]!.id();
    const table = originalTable
      .update((mutator) => mutator.updateViewDescription(targetId, 'Temporary description'))
      ._unsafeUnwrap().table;
    const target = table.views()[0]!;
    const snapshot = captureViewSnapshot(target)._unsafeUnwrap();
    const snapshotView = rehydrateViewSnapshot({
      ...snapshot,
      properties: {
        ...snapshot.properties,
        description: undefined,
      },
      options: undefined,
    })._unsafeUnwrap();

    const result = table.applyViewSnapshot(snapshotView)._unsafeUnwrap();
    const restored = result.updateResult!.table.getView(target.id())._unsafeUnwrap();
    expect(restored.description()).toBeUndefined();
    expect(restored.options()).toBeUndefined();
  });
});
