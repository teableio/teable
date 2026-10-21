import { describe, expect, it } from 'vitest';

import { BaseId } from '../../base/BaseId';
import { ViewShareMetaUpdated } from '../events/ViewShareMetaUpdated';
import { FieldName } from '../fields/FieldName';
import { TableUpdateViewShareMetaSpec } from '../specs/TableUpdateViewShareMetaSpec';
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

describe('Table.updateViewShareMeta', () => {
  it('replaces share metadata and emits a focused aggregate event', () => {
    const table = buildTable();
    const view = table.views()[0]!;
    const shareMeta = {
      allowCopy: true,
      includeHiddenField: true,
      password: 'secret',
      includeRecords: true,
      submit: { requireLogin: true },
      allowEdit: true,
    };

    const result = table.updateViewShareMeta(view.id(), shareMeta)._unsafeUnwrap();

    expect(result.previousShareMeta).toBeUndefined();
    expect(result.nextShareMeta).toEqual(shareMeta);
    expect(result.view.shareMeta()).toEqual(shareMeta);
    expect(result.updateResult?.mutateSpec).toBeInstanceOf(TableUpdateViewShareMetaSpec);
    const events = result.updateResult?.table.pullDomainEvents() ?? [];
    expect(events).toEqual([
      expect.objectContaining({
        previousShareMeta: undefined,
        nextShareMeta: shareMeta,
        viewId: view.id(),
      }),
    ]);
    expect(events.every((event) => event instanceof ViewShareMetaUpdated)).toBe(true);
  });

  it('preserves empty metadata, supports snapshot clearing, and skips identical updates', () => {
    const table = buildTable();
    const viewId = table.views()[0]!.id();
    const empty = table.updateViewShareMeta(viewId, {})._unsafeUnwrap();
    expect(empty.view.shareMeta()).toEqual({});

    const noOp = empty.updateResult!.table.updateViewShareMeta(viewId, {})._unsafeUnwrap();
    expect(noOp.updateResult).toBeUndefined();

    const cleared = empty
      .updateResult!.table.updateViewShareMeta(viewId, undefined)
      ._unsafeUnwrap();
    expect(cleared.view.shareMeta()).toBeUndefined();
  });

  it('rejects invalid metadata and a View outside the Table aggregate', () => {
    const table = buildTable();
    const viewId = table.views()[0]!.id();

    expect(table.updateViewShareMeta(viewId, { password: 'ab' }).isErr()).toBe(true);
    expect(table.updateViewShareMeta(viewId, { allowCopy: 'yes' }).isErr()).toBe(true);
    expect(table.updateViewShareMeta(viewId, { unknown: true }).isErr()).toBe(true);
    expect(
      table
        .updateViewShareMeta(ViewId.create(`viw${'z'.repeat(16)}`)._unsafeUnwrap(), {})
        ._unsafeUnwrapErr().code
    ).toBe('view.not_found');
  });
});
