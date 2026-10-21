import { describe, expect, it } from 'vitest';

import { BaseId } from '../../base/BaseId';
import { FieldName } from '../fields/FieldName';
import { Table } from '../Table';
import { TableId } from '../TableId';
import { TableName } from '../TableName';
import type { View } from '../views/View';
import { captureViewSnapshot, rehydrateViewSnapshot } from '../views/ViewSnapshot';

const buildTable = (): Table => {
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'v'.repeat(16)}`)._unsafeUnwrap())
    .withId(TableId.create(`tbl${'v'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Gallery meta')._unsafeUnwrap());
  builder.field().singleLineText().withName(FieldName.create('Title')._unsafeUnwrap()).done();
  builder.field().singleLineText().withName(FieldName.create('Subtitle')._unsafeUnwrap()).done();
  builder.view().defaultGrid().done();
  builder.view().gallery().defaultName().done();
  builder.view().kanban().defaultName().done();
  return builder.build()._unsafeUnwrap();
};

const viewOfType = (table: Table, type: string): View =>
  table.views().find((view) => view.type().toString() === type)!;

const rehydrateGalleryWithHiddenPrimary = (table: Table): Table => {
  const gallery = viewOfType(table, 'gallery');
  const snapshot = captureViewSnapshot(gallery)._unsafeUnwrap();
  const primaryKey = table.primaryFieldId().toString();
  const secondaryKey = table.getFields()[1]!.id().toString();
  const historicalView = rehydrateViewSnapshot({
    ...snapshot,
    columnMeta: {
      ...snapshot.columnMeta,
      [primaryKey]: { ...snapshot.columnMeta[primaryKey], order: 0, width: 260, visible: false },
      [secondaryKey]: {
        ...snapshot.columnMeta[secondaryKey],
        order: 1,
        width: 120,
        visible: false,
      },
    },
  })._unsafeUnwrap();

  return Table.rehydrate({
    id: table.id(),
    baseId: table.baseId(),
    name: table.name(),
    fields: table.getFields(),
    views: table.views().map((view) => (view.id().equals(gallery.id()) ? historicalView : view)),
    primaryFieldId: table.primaryFieldId(),
  })._unsafeUnwrap();
};

describe('Table.updateViewColumnMeta gallery primary visibility', () => {
  it('persists the gallery primary visible while applying the requested metadata', () => {
    const table = buildTable();
    const gallery = viewOfType(table, 'gallery');
    const primaryFieldId = table.primaryFieldId();
    const primaryKey = primaryFieldId.toString();
    const secondaryFieldId = table.getFields()[1]!.id();

    const result = table
      .updateViewColumnMeta(gallery.id(), [
        { fieldId: primaryFieldId, columnMeta: { visible: false, width: 320 } },
        { fieldId: secondaryFieldId, columnMeta: { visible: false, width: 140 } },
      ])
      ._unsafeUnwrap();

    const nextColumnMeta = result.nextColumnMeta.toDto();
    expect(nextColumnMeta[primaryKey]).toMatchObject({ visible: true, width: 320 });
    expect(nextColumnMeta[secondaryFieldId.toString()]).toMatchObject({
      visible: false,
      width: 140,
    });

    const persisted = result
      .updateResult!.table.getView(gallery.id())
      ._unsafeUnwrap()
      .columnMeta()
      ._unsafeUnwrap()
      .toDto();
    expect(persisted).toEqual(nextColumnMeta);
    expect(
      result.changes.find(({ fieldId }) => fieldId.equals(primaryFieldId))?.nextColumnMeta
    ).toMatchObject({ visible: true, width: 320 });
  });

  it('repairs a historical hidden primary when another field metadata changes', () => {
    const table = rehydrateGalleryWithHiddenPrimary(buildTable());
    const gallery = viewOfType(table, 'gallery');
    const primaryFieldId = table.primaryFieldId();
    const secondaryFieldId = table.getFields()[1]!.id();

    const result = table
      .updateViewColumnMeta(gallery.id(), [
        { fieldId: secondaryFieldId, columnMeta: { width: 180 } },
      ])
      ._unsafeUnwrap();

    const persisted = result
      .updateResult!.table.getView(gallery.id())
      ._unsafeUnwrap()
      .columnMeta()
      ._unsafeUnwrap()
      .toDto();
    expect(persisted[primaryFieldId.toString()]).toEqual({
      order: 0,
      width: 260,
      visible: true,
    });
    expect(persisted[secondaryFieldId.toString()]).toMatchObject({
      width: 180,
      visible: false,
    });
    expect(result.changes.some(({ fieldId }) => fieldId.equals(primaryFieldId))).toBe(true);
  });

  it('repairs a historical hidden primary when the patch only changes its width', () => {
    const table = rehydrateGalleryWithHiddenPrimary(buildTable());
    const gallery = viewOfType(table, 'gallery');
    const primaryFieldId = table.primaryFieldId();

    const result = table
      .updateViewColumnMeta(gallery.id(), [{ fieldId: primaryFieldId, columnMeta: { width: 300 } }])
      ._unsafeUnwrap();

    const persisted = result
      .updateResult!.table.getView(gallery.id())
      ._unsafeUnwrap()
      .columnMeta()
      ._unsafeUnwrap()
      .toDto();
    expect(persisted[primaryFieldId.toString()]).toEqual({
      order: 0,
      width: 300,
      visible: true,
    });
  });

  it.each(['grid', 'kanban'] as const)('leaves the %s primary visibility as requested', (type) => {
    const table = buildTable();
    const view = viewOfType(table, type);
    const primaryFieldId = table.primaryFieldId();

    const result = table
      .updateViewColumnMeta(view.id(), [
        { fieldId: primaryFieldId, columnMeta: { visible: false } },
      ])
      ._unsafeUnwrap();

    const persisted = result
      .updateResult!.table.getView(view.id())
      ._unsafeUnwrap()
      .columnMeta()
      ._unsafeUnwrap()
      .toDto();
    expect(persisted[primaryFieldId.toString()]).toMatchObject({ visible: false });
  });
});
