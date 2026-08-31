import { describe, expect, it } from 'vitest';

import { BaseId } from '../../base/BaseId';
import { ViewOptionsUpdated } from '../events/ViewOptionsUpdated';
import { FieldName } from '../fields/FieldName';
import { TableUpdateViewOptionsSpec } from '../specs/TableUpdateViewOptionsSpec';
import { Table } from '../Table';
import { TableName } from '../TableName';
import type { IViewTypeLiteral } from '../views/ViewType';

const buildTable = (): Table => {
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Options')._unsafeUnwrap());
  builder.field().singleLineText().withName(FieldName.create('Name')._unsafeUnwrap()).done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

const createView = (table: Table, type: IViewTypeLiteral, options?: unknown) =>
  table.createView({ type, options })._unsafeUnwrap();

describe('Table.updateViewOptions', () => {
  it('shallow-merges grid options and emits a focused mutation event', () => {
    const created = createView(buildTable(), 'grid', {
      rowHeight: 'short',
      fieldNameDisplayLines: 1,
    });
    const result = created.updateResult.table
      .updateViewOptions(created.view.id(), { rowHeight: 'tall' })
      ._unsafeUnwrap();

    expect(result.previousOptions).toEqual({
      rowHeight: 'short',
      fieldNameDisplayLines: 1,
    });
    expect(result.nextOptions).toEqual({
      rowHeight: 'tall',
      fieldNameDisplayLines: 1,
    });
    expect(result.updateResult?.mutateSpec).toBeInstanceOf(TableUpdateViewOptionsSpec);
    expect(result.view.options()).toEqual(result.nextOptions);
    const event = result.updateResult?.table
      .pullDomainEvents()
      .find((candidate) => candidate instanceof ViewOptionsUpdated);
    expect(event).toBeInstanceOf(ViewOptionsUpdated);
  });

  it.each([
    ['grid', { rowHeight: 'autoFit', frozenColumnCount: 2 }],
    ['gallery', { coverFieldId: null, isCoverFit: true }],
    ['kanban', { stackFieldId: 'fld-stack', isEmptyStackHidden: true }],
    [
      'calendar',
      {
        startDateFieldId: null,
        colorConfig: { type: 'custom', color: 'blue' },
      },
    ],
    ['form', { submitLabel: 'Send', coverUrl: 'https://example.test/cover' }],
    [
      'plugin',
      {
        pluginId: 'plg-view',
        pluginInstallId: 'pli-view',
        pluginLogo: 'https://example.test/logo.png',
      },
    ],
  ] as const)('validates and updates %s options inside the aggregate', (type, patch) => {
    const created =
      type === 'plugin' ? createView(buildTable(), type, patch) : createView(buildTable(), type);
    const source = created.updateResult.table;

    const result = source.updateViewOptions(created.view.id(), patch)._unsafeUnwrap();

    expect(result.nextOptions).toEqual(patch);
    if (type === 'plugin') {
      expect(result.updateResult).toBeUndefined();
    } else {
      expect(result.updateResult).toBeDefined();
    }
  });

  it('preserves explicit null values and treats an identical patch as a no-op', () => {
    const created = createView(buildTable(), 'gallery', {
      coverFieldId: 'fld-cover',
      isCoverFit: true,
    });
    const cleared = created.updateResult.table
      .updateViewOptions(created.view.id(), { coverFieldId: null })
      ._unsafeUnwrap();
    expect(cleared.nextOptions).toEqual({ coverFieldId: null, isCoverFit: true });

    const noOp = cleared
      .updateResult!.table.updateViewOptions(created.view.id(), { coverFieldId: null })
      ._unsafeUnwrap();
    expect(noOp.updateResult).toBeUndefined();
  });

  it('rejects subtype mismatches, invalid values, and incomplete plugin patches', () => {
    const grid = createView(buildTable(), 'grid');
    expect(
      grid.updateResult.table.updateViewOptions(grid.view.id(), { submitLabel: 'Wrong' }).isErr()
    ).toBe(true);
    expect(
      grid.updateResult.table.updateViewOptions(grid.view.id(), { rowHeight: 'huge' }).isErr()
    ).toBe(true);

    const pluginOptions = {
      pluginId: 'plg-view',
      pluginInstallId: 'pli-view',
      pluginLogo: 'https://example.test/logo.png',
    };
    const plugin = createView(buildTable(), 'plugin', pluginOptions);
    expect(
      plugin.updateResult.table
        .updateViewOptions(plugin.view.id(), { pluginLogo: 'next.png' })
        .isErr()
    ).toBe(true);
  });

  it('rejects a View outside the loaded Table aggregate', () => {
    const first = buildTable();
    const second = buildTable();
    expect(first.updateViewOptions(second.views()[0]!.id(), {}).isErr()).toBe(true);
  });
});
