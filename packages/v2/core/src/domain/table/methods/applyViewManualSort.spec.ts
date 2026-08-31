import { describe, expect, it } from 'vitest';

import { BaseId } from '../../base/BaseId';
import { ViewManualSortApplied } from '../events/ViewManualSortApplied';
import { ViewSortUpdated } from '../events/ViewSortUpdated';
import { FieldName } from '../fields/FieldName';
import { TableUpdateViewQueryDefaultsSpec } from '../specs/TableUpdateViewQueryDefaultsSpec';
import { TableEnsureViewRowOrderSpec } from '../specs/TableEnsureViewRowOrderSpec';
import { Table } from '../Table';
import { TableId } from '../TableId';
import { TableName } from '../TableName';
import { ViewId } from '../views/ViewId';

const buildTable = (suffix = 'a'): Table => {
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${suffix.repeat(16)}`)._unsafeUnwrap())
    .withId(TableId.create(`tbl${suffix.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Manual sort views')._unsafeUnwrap());
  builder.field().singleLineText().withName(FieldName.create('Name')._unsafeUnwrap()).done();
  builder.field().number().withName(FieldName.create('Amount')._unsafeUnwrap()).done();
  builder.field().button().withName(FieldName.create('Action')._unsafeUnwrap()).done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

describe('Table.applyViewManualSort', () => {
  it('owns validation and emits View state plus row-order materialization intent', () => {
    const table = buildTable();
    const viewId = table.views()[0]!.id();
    const sort = [
      { fieldId: table.getFields()[0]!.id().toString(), order: 'asc' as const },
      { fieldId: table.getFields()[1]!.id().toString(), order: 'desc' as const },
    ];

    const result = table.applyViewManualSort(viewId, sort)._unsafeUnwrap();

    expect(result.nextSort).toEqual({ sortObjs: sort, manualSort: true });
    expect(result.nextQueryDefaults.manualSort()).toBe(true);
    expect(result.updateResult?.mutateSpec).toBeInstanceOf(TableUpdateViewQueryDefaultsSpec);
    expect(result.rowOrderStorageSpec).toBeInstanceOf(TableEnsureViewRowOrderSpec);
    const events = result.table.pullDomainEvents();
    expect(events).toHaveLength(2);
    expect(events[0]).toBeInstanceOf(ViewSortUpdated);
    expect(events[1]).toBeInstanceOf(ViewManualSortApplied);
    expect(events[1]).toMatchObject({ viewId, sort });
  });

  it('supports empty sort and treats an identical manual state as a no-op', () => {
    const table = buildTable();
    const viewId = table.views()[0]!.id();
    const first = table.applyViewManualSort(viewId, [])._unsafeUnwrap();
    expect(first.nextSort).toEqual({ sortObjs: [], manualSort: true });
    first.table.pullDomainEvents();

    const identical = first.table.applyViewManualSort(viewId, [])._unsafeUnwrap();
    expect(identical.updateResult).toBeUndefined();
    expect(identical.table.pullDomainEvents()).toEqual([]);
  });

  it('rejects another aggregate child, missing fields, Button fields, and malformed sort', () => {
    const table = buildTable('b');
    const another = buildTable('c');
    const viewId = table.views()[0]!.id();

    expect(table.applyViewManualSort(another.views()[0]!.id(), [])._unsafeUnwrapErr().code).toBe(
      'view.not_found'
    );
    expect(
      table
        .applyViewManualSort(viewId, [{ fieldId: `fld${'z'.repeat(16)}`, order: 'asc' }])
        ._unsafeUnwrapErr().code
    ).toBe('field.not_found');
    expect(
      table
        .applyViewManualSort(viewId, [
          { fieldId: table.getFields()[2]!.id().toString(), order: 'desc' },
        ])
        ._unsafeUnwrapErr().code
    ).toBe('view.sort_unsupported_field_type');
    expect(
      table.applyViewManualSort(ViewId.create(`viw${'z'.repeat(16)}`)._unsafeUnwrap(), []).isErr()
    ).toBe(true);
    expect(table.applyViewManualSort(viewId, [{ fieldId: 'bad', order: 'up' }]).isErr()).toBe(true);
  });

  it('rejects manual row-order materialization for a non-Grid View', () => {
    const table = buildTable('d');
    const galleryBuilder = Table.builder()
      .withBaseId(table.baseId())
      .withId(TableId.create(`tbl${'e'.repeat(16)}`)._unsafeUnwrap())
      .withName(TableName.create('View source')._unsafeUnwrap());
    galleryBuilder
      .field()
      .singleLineText()
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .done();
    galleryBuilder.view().gallery().defaultName().done();
    const gallery = galleryBuilder.build()._unsafeUnwrap().views()[0]!;
    const update = table.update((mutator) => mutator.addView(gallery));
    const galleryTable = update._unsafeUnwrap().table;
    const galleryView = galleryTable.views().find((view) => view.type().toString() === 'gallery')!;

    expect(galleryTable.applyViewManualSort(galleryView.id(), [])._unsafeUnwrapErr().code).toBe(
      'view.manual_sort_unsupported_type'
    );
  });
});
