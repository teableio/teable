import { describe, expect, it } from 'vitest';

import { BaseId } from '../../base/BaseId';
import { ViewShareIdRefreshed } from '../events/ViewShareIdRefreshed';
import { FieldName } from '../fields/FieldName';
import { TableUpdateViewShareIdSpec } from '../specs/TableUpdateViewShareIdSpec';
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

const buildSharedTable = (shareId?: string): { table: Table; viewId: ViewId } => {
  const created = buildTable()
    .createView({
      type: 'grid',
      name: 'Public View',
      enableShare: true,
      shareId,
    })
    ._unsafeUnwrap();
  created.updateResult.table.pullDomainEvents();
  return { table: created.updateResult.table, viewId: created.view.id() };
};

describe('Table.refreshViewShareId', () => {
  it('rotates the credential and emits an irreversible focused event', () => {
    const previousShareId = `shr${'s'.repeat(16)}`;
    const { table, viewId } = buildSharedTable(previousShareId);

    const result = table.refreshViewShareId(viewId)._unsafeUnwrap();

    expect(result.previousShareId).toBe(previousShareId);
    expect(result.nextShareId).toMatch(/^shr[0-9a-zA-Z]{16}$/);
    expect(result.nextShareId).not.toBe(previousShareId);
    expect(result.view.shareId()).toBe(result.nextShareId);
    expect(result.view.enableShare()).toBe(true);
    expect(result.updateResult.mutateSpec).toBeInstanceOf(TableUpdateViewShareIdSpec);
    const events = result.updateResult.table.pullDomainEvents();
    expect(events).toEqual([
      expect.objectContaining({
        previousShareId,
        nextShareId: result.nextShareId,
        viewId,
      }),
    ]);
    expect(events.every((event) => event instanceof ViewShareIdRefreshed)).toBe(true);
  });

  it('mints a credential when sharing is enabled but the current ID is absent', () => {
    const { table, viewId } = buildSharedTable();

    const result = table.refreshViewShareId(viewId)._unsafeUnwrap();

    expect(result.previousShareId).toBeUndefined();
    expect(result.nextShareId).toMatch(/^shr[0-9a-zA-Z]{16}$/);
  });

  it('rejects disabled sharing and a View outside the Table aggregate', () => {
    const table = buildTable();
    const viewId = table.views()[0]!.id();

    expect(table.refreshViewShareId(viewId)._unsafeUnwrapErr().code).toBe('validation.invalid');
    expect(
      table
        .refreshViewShareId(ViewId.create(`viw${'z'.repeat(16)}`)._unsafeUnwrap())
        ._unsafeUnwrapErr().code
    ).toBe('view.not_found');
  });
});
