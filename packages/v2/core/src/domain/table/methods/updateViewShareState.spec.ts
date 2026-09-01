import { describe, expect, it } from 'vitest';

import { BaseId } from '../../base/BaseId';
import { ViewShareDisabled } from '../events/ViewShareDisabled';
import { ViewShareEnabled } from '../events/ViewShareEnabled';
import { FieldName } from '../fields/FieldName';
import { TableUpdateViewShareStateSpec } from '../specs/TableUpdateViewShareStateSpec';
import { Table } from '../Table';
import { TableName } from '../TableName';
import { ViewId } from '../views/ViewId';

const buildTable = (): Table => {
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Shared Views')._unsafeUnwrap());
  builder.field().singleLineText().withName(FieldName.create('Name')._unsafeUnwrap()).done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

describe('Table View share lifecycle', () => {
  it('enables sharing inside the aggregate, mints a credential, and defaults grid metadata', () => {
    const table = buildTable();
    const viewId = table.views()[0]!.id();

    const result = table.enableViewShare(viewId)._unsafeUnwrap();

    expect(result.shareId).toMatch(/^shr[0-9a-zA-Z]{16}$/);
    expect(result.view.enableShare()).toBe(true);
    expect(result.view.shareId()).toBe(result.shareId);
    expect(result.view.shareMeta()).toEqual({ includeRecords: true });
    expect(result.updateResult.mutateSpec).toBeInstanceOf(TableUpdateViewShareStateSpec);
    expect(result.updateResult.table.pullDomainEvents()).toEqual([
      expect.objectContaining({
        viewId,
        shareId: result.shareId,
        shareMeta: { includeRecords: true },
      }),
    ]);
  });

  it('uses empty default metadata for forms and preserves existing metadata', () => {
    const formCreated = buildTable()
      .createView({ type: 'form', name: 'Public form' })
      ._unsafeUnwrap();
    const formTable = formCreated.updateResult.table;
    formTable.pullDomainEvents();

    const formResult = formTable.enableViewShare(formCreated.view.id())._unsafeUnwrap();
    expect(formResult.view.shareMeta()).toEqual({});

    const gridId = formResult.updateResult.table.views()[0]!.id();
    const withMeta = formResult.updateResult.table
      .updateViewShareMeta(gridId, { allowCopy: true })
      ._unsafeUnwrap().updateResult!.table;
    withMeta.pullDomainEvents();
    expect(withMeta.enableViewShare(gridId)._unsafeUnwrap().view.shareMeta()).toEqual({
      allowCopy: true,
    });
  });

  it('disables sharing while retaining credentials and metadata for aggregate state', () => {
    const table = buildTable();
    const viewId = table.views()[0]!.id();
    const enabled = table.enableViewShare(viewId)._unsafeUnwrap();
    enabled.updateResult.table.pullDomainEvents();

    const result = enabled.updateResult.table.disableViewShare(viewId)._unsafeUnwrap();

    expect(result.view.enableShare()).toBe(false);
    expect(result.view.shareId()).toBe(enabled.shareId);
    expect(result.view.shareMeta()).toEqual({ includeRecords: true });
    expect(result.updateResult.table.pullDomainEvents()).toEqual([
      expect.objectContaining({
        viewId,
        previousShareId: enabled.shareId,
        shareMeta: { includeRecords: true },
      }),
    ]);
  });

  it('rejects repeated transitions and a View outside the Table aggregate', () => {
    const table = buildTable();
    const viewId = table.views()[0]!.id();
    expect(table.disableViewShare(viewId)._unsafeUnwrapErr().code).toBe('validation.invalid');

    const enabled = table.enableViewShare(viewId)._unsafeUnwrap().updateResult.table;
    expect(enabled.enableViewShare(viewId)._unsafeUnwrapErr().code).toBe('validation.invalid');
    expect(
      table
        .enableViewShare(ViewId.create(`viw${'z'.repeat(16)}`)._unsafeUnwrap())
        ._unsafeUnwrapErr().code
    ).toBe('view.not_found');
  });

  it('emits focused enable and disable event types', () => {
    const table = buildTable();
    const viewId = table.views()[0]!.id();
    const enabled = table.enableViewShare(viewId)._unsafeUnwrap();
    expect(enabled.updateResult.table.pullDomainEvents()[0]).toBeInstanceOf(ViewShareEnabled);

    const disabled = enabled.updateResult.table.disableViewShare(viewId)._unsafeUnwrap();
    expect(disabled.updateResult.table.pullDomainEvents()[0]).toBeInstanceOf(ViewShareDisabled);
  });
});
