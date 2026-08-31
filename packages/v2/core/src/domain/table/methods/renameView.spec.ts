import { describe, expect, it } from 'vitest';

import { BaseId } from '../../base/BaseId';
import { ViewRenamed } from '../events/ViewRenamed';
import { FieldName } from '../fields/FieldName';
import { TableRenameViewSpec } from '../specs/TableRenameViewSpec';
import { Table } from '../Table';
import { TableId } from '../TableId';
import { TableName } from '../TableName';
import { ViewAuditMetadata } from '../views/ViewAuditMetadata';
import { ViewId } from '../views/ViewId';
import { ViewName } from '../views/ViewName';

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

describe('Table.renameView', () => {
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
  ] as const)('renames an owned %s View while preserving its complete state', (type, options) => {
    const table = buildTable();
    const [titleField] = table.getFields();
    const created = table
      .createView({
        type,
        name: `${type} source`,
        description: 'Delivery details',
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
        isLocked: true,
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

    const result = current
      .renameView(source.id(), ViewName.create(`${type} renamed`)._unsafeUnwrap())
      ._unsafeUnwrap();

    expect(result.previousName.toString()).toBe(`${type} source`);
    expect(result.nextName.toString()).toBe(`${type} renamed`);
    expect(result.updateResult.mutateSpec).toBeInstanceOf(TableRenameViewSpec);
    expect(result.view.id().equals(source.id())).toBe(true);
    expect(result.view.type().toString()).toBe(type);
    expect(result.view.description()).toBe(source.description());
    expect(result.view.properties()).toEqual(source.properties());
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
    expect(event).toBeInstanceOf(ViewRenamed);
    expect(event).toMatchObject({
      previousName: result.previousName,
      nextName: result.nextName,
      viewId: source.id(),
    });
  });

  it('rejects a duplicate active View name inside the Table aggregate', () => {
    const table = buildTable();
    const created = table.createView({ type: 'grid', name: 'Delivery' })._unsafeUnwrap()
      .updateResult.table;

    const result = created.renameView(
      created.views()[0]!.id(),
      ViewName.create('Delivery')._unsafeUnwrap()
    );

    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: 'conflict',
      message: 'View names must be unique',
    });
  });

  it('allows empty and unchanged names because ViewName accepts both', () => {
    const table = buildTable();
    const viewId = table.views()[0]!.id();
    const empty = table.renameView(viewId, ViewName.create('')._unsafeUnwrap())._unsafeUnwrap();
    const unchanged = empty.updateResult.table
      .renameView(viewId, ViewName.create('')._unsafeUnwrap())
      ._unsafeUnwrap();

    expect(empty.view.name().toString()).toBe('');
    expect(unchanged.view.name().toString()).toBe('');
  });

  it('rejects a View id outside the aggregate', () => {
    const result = buildTable().renameView(
      ViewId.create(`viw${'z'.repeat(16)}`)._unsafeUnwrap(),
      ViewName.create('Missing')._unsafeUnwrap()
    );

    expect(result._unsafeUnwrapErr().code).toBe('view.not_found');
  });
});
