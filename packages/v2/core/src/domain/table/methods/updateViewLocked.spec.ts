import { describe, expect, it } from 'vitest';

import { BaseId } from '../../base/BaseId';
import { ViewLockedUpdated } from '../events/ViewLockedUpdated';
import { FieldName } from '../fields/FieldName';
import { TableUpdateViewLockedSpec } from '../specs/TableUpdateViewLockedSpec';
import { Table } from '../Table';
import { TableId } from '../TableId';
import { TableName } from '../TableName';
import { ViewAuditMetadata } from '../views/ViewAuditMetadata';
import { ViewId } from '../views/ViewId';

const buildTable = (): Table => {
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
    .withId(TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Planning')._unsafeUnwrap());
  builder.field().singleLineText().withName(FieldName.create('Title')._unsafeUnwrap()).done();
  builder.field().attachment().withName(FieldName.create('Cover')._unsafeUnwrap()).done();
  builder.field().date().withName(FieldName.create('Start')._unsafeUnwrap()).done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

describe('Table.updateViewLocked', () => {
  it.each([
    ['grid', { rowHeight: 'extraTall', frozenColumnCount: 1 }],
    ['calendar', { startDateFieldId: null, endDateFieldId: null }],
    ['kanban', { coverFieldId: null, isCoverFit: true }],
    ['form', { coverUrl: '', submitLabel: 'Send' }],
    ['gallery', { coverFieldId: null, isFieldNameHidden: true }],
    [
      'plugin',
      {
        pluginId: 'plg-source',
        pluginInstallId: 'pli-source',
        pluginLogo: 'source-logo',
      },
    ],
  ] as const)('updates an owned %s View while preserving all other state', (type, options) => {
    const table = buildTable();
    const [titleField] = table.getFields();
    const created = table
      .createView({
        type,
        name: `${type} source`,
        description: 'Description',
        columnMeta: {
          [titleField!.id().toString()]: { width: 280, hidden: true },
        },
        options,
        filter: {
          conjunction: 'and',
          items: [{ fieldId: titleField!.id().toString(), operator: 'is', value: 'alpha' }],
        },
        sourceFilter: {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: titleField!.id().toString(),
              operator: '=',
              isSymbol: true,
              value: 'alpha',
            },
          ],
        },
        sort: [{ fieldId: titleField!.id().toString(), order: 'desc' }],
        group: [{ fieldId: titleField!.id().toString(), order: 'asc' }],
        manualSort: false,
        isLocked: false,
        enableShare: true,
        shareId: `shr${'s'.repeat(16)}`,
        shareMeta: { allowCopy: false },
      })
      ._unsafeUnwrap();
    const source = created.view;
    source
      .setAuditMetadata(
        ViewAuditMetadata.rehydrate({
          createdBy: 'usr-created',
          createdTime: '2026-01-01T00:00:00.000Z',
          lastModifiedBy: 'usr-modified',
          lastModifiedTime: '2026-01-02T00:00:00.000Z',
        })._unsafeUnwrap()
      )
      ._unsafeUnwrap();
    const current = created.updateResult.table;
    current.pullDomainEvents();

    const result = current.updateViewLocked(source.id(), true)._unsafeUnwrap();

    expect(result.previousIsLocked).toBe(false);
    expect(result.nextIsLocked).toBe(true);
    expect(result.updateResult.mutateSpec).toBeInstanceOf(TableUpdateViewLockedSpec);
    expect(result.view.id().equals(source.id())).toBe(true);
    expect(result.view.name().equals(source.name())).toBe(true);
    expect(result.view.type().toString()).toBe(type);
    expect(result.view.isLocked()).toBe(true);
    expect(result.view.properties().toDto()).toEqual({
      ...source.properties().toDto(),
      isLocked: true,
    });
    expect(result.view.options()).toEqual(source.options());
    expect(result.view.columnMeta()._unsafeUnwrap().toDto()).toEqual(
      source.columnMeta()._unsafeUnwrap().toDto()
    );
    expect(result.view.queryDefaults()._unsafeUnwrap().toDto()).toEqual(
      source.queryDefaults()._unsafeUnwrap().toDto()
    );
    expect(result.view.queryDefaults()._unsafeUnwrap().sourceFilter()).toEqual(
      source.queryDefaults()._unsafeUnwrap().sourceFilter()
    );
    expect(result.view.auditMetadata()._unsafeUnwrap().toDto()).toEqual(
      source.auditMetadata()._unsafeUnwrap().toDto()
    );
    const [event] = result.updateResult.table.pullDomainEvents();
    expect(event).toBeInstanceOf(ViewLockedUpdated);
    expect(event).toMatchObject({
      previousIsLocked: false,
      nextIsLocked: true,
      viewId: source.id(),
    });
  });

  it('preserves true, false, omitted, and unchanged states exactly', () => {
    const table = buildTable();
    const viewId = table.views()[0]!.id();
    const locked = table.updateViewLocked(viewId, true)._unsafeUnwrap();
    const unlocked = locked.updateResult.table.updateViewLocked(viewId, false)._unsafeUnwrap();
    const omitted = unlocked.updateResult.table.updateViewLocked(viewId, undefined)._unsafeUnwrap();
    const unchanged = omitted.updateResult.table
      .updateViewLocked(viewId, undefined)
      ._unsafeUnwrap();

    expect(locked.previousIsLocked).toBeUndefined();
    expect(locked.view.isLocked()).toBe(true);
    expect(unlocked.previousIsLocked).toBe(true);
    expect(unlocked.view.isLocked()).toBe(false);
    expect(omitted.previousIsLocked).toBe(false);
    expect(omitted.view.isLocked()).toBeUndefined();
    expect(unchanged.previousIsLocked).toBeUndefined();
    expect(unchanged.view.isLocked()).toBeUndefined();
  });

  it('rejects a View id outside the aggregate', () => {
    const result = buildTable().updateViewLocked(
      ViewId.create(`viw${'z'.repeat(16)}`)._unsafeUnwrap(),
      true
    );

    expect(result._unsafeUnwrapErr().code).toBe('view.not_found');
  });
});
