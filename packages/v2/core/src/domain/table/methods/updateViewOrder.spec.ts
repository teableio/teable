import { describe, expect, it } from 'vitest';

import { BaseId } from '../../base/BaseId';
import { ViewOrderUpdated } from '../events/ViewOrderUpdated';
import { FieldName } from '../fields/FieldName';
import { TableUpdateViewOrderSpec } from '../specs/TableUpdateViewOrderSpec';
import { Table } from '../Table';
import { TableId } from '../TableId';
import { TableName } from '../TableName';
import { ViewId } from '../views/ViewId';
import { ViewOrder } from '../views/ViewOrder';

const buildTable = (orders: ReadonlyArray<number> = [0, 1, 2]): Table => {
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
    .withId(TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Views')._unsafeUnwrap());
  builder.field().singleLineText().withName(FieldName.create('Title')._unsafeUnwrap()).done();
  builder.view().defaultGrid().done();
  let table = builder.build()._unsafeUnwrap();
  while (table.views().length < orders.length) {
    table = table
      .createView({ type: 'grid', name: `View ${table.views().length + 1}` })
      ._unsafeUnwrap().updateResult.table;
  }
  table.pullDomainEvents();
  table.views().forEach((view, index) => {
    view.setOrder(ViewOrder.rehydrate(orders[index])._unsafeUnwrap())._unsafeUnwrap();
  });
  return table;
};

const ids = (table: Table): string[] => table.views().map((view) => view.id().toString());

describe('Table.updateViewOrder', () => {
  it('moves before and after an anchor with fractional and boundary coordinates', () => {
    const beforeTable = buildTable();
    const [first, second, third] = beforeTable.views();
    const before = beforeTable.updateViewOrder(third!.id(), second!.id(), 'before')._unsafeUnwrap();

    expect(before.previousOrder.toNumber()).toBe(2);
    expect(before.nextOrder.toNumber()).toBe(0.5);
    expect(ids(before.updateResult.table)).toEqual([
      first!.id().toString(),
      third!.id().toString(),
      second!.id().toString(),
    ]);
    expect(before.updateResult.mutateSpec).toBeInstanceOf(TableUpdateViewOrderSpec);

    const afterTable = buildTable();
    const [afterFirst, , afterThird] = afterTable.views();
    const after = afterTable
      .updateViewOrder(afterFirst!.id(), afterThird!.id(), 'after')
      ._unsafeUnwrap();
    expect(after.nextOrder.toNumber()).toBe(3);
    expect(ids(after.updateResult.table).at(-1)).toBe(afterFirst!.id().toString());
  });

  it('preserves legacy nearest-neighbor behavior when source is already adjacent', () => {
    const table = buildTable();
    const [first, second] = table.views();
    const result = table.updateViewOrder(first!.id(), second!.id(), 'before')._unsafeUnwrap();

    expect(result.previousOrder.toNumber()).toBe(0);
    expect(result.nextOrder.toNumber()).toBe(0.5);
    expect(ids(result.updateResult.table)).toEqual(ids(table));
  });

  it('allows source and anchor to be the same View and still records the legacy update', () => {
    const table = buildTable();
    const source = table.views()[1]!;
    const result = table.updateViewOrder(source.id(), source.id(), 'after')._unsafeUnwrap();

    expect(result.previousOrder.toNumber()).toBe(1);
    expect(result.nextOrder.toNumber()).toBe(1.5);
    expect(result.changes).toHaveLength(1);
  });

  it('normalizes every View when the anchor gap is exhausted, then applies the source move', () => {
    const table = buildTable([0, 1 - Number.EPSILON, 1]);
    const [source, neighbor, anchor] = table.views();
    const result = table.updateViewOrder(source!.id(), anchor!.id(), 'before')._unsafeUnwrap();

    expect(result.changes).toHaveLength(4);
    expect(result.changes.slice(0, 3).map((change) => change.nextOrder.toNumber())).toEqual([
      0, 1, 2,
    ]);
    expect(result.nextOrder.toNumber()).toBe(1.5);
    expect(ids(result.updateResult.table)).toEqual([
      neighbor!.id().toString(),
      source!.id().toString(),
      anchor!.id().toString(),
    ]);
    const events = result.updateResult.table.pullDomainEvents();
    expect(events).toHaveLength(4);
    expect(events.every((event) => event instanceof ViewOrderUpdated)).toBe(true);
  });

  it('distinguishes a missing source from a missing anchor inside the aggregate', () => {
    const table = buildTable();
    const missing = ViewId.create(`viw${'z'.repeat(16)}`)._unsafeUnwrap();
    expect(
      table.updateViewOrder(missing, table.views()[0]!.id(), 'before')._unsafeUnwrapErr().code
    ).toBe('view.not_found');
    expect(
      table.updateViewOrder(table.views()[0]!.id(), missing, 'before')._unsafeUnwrapErr().code
    ).toBe('view.anchor_not_found');
  });
});
