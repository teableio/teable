import { describe, expect, it } from 'vitest';

import { BaseId } from '../../base/BaseId';
import { FieldName } from '../fields/FieldName';
import { Table } from '../Table';
import { TableName } from '../TableName';
import { captureViewSnapshot, rehydrateViewSnapshot } from './ViewSnapshot';

const buildTable = (): Table => {
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'s'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Snapshot')._unsafeUnwrap());
  builder.field().singleLineText().withName(FieldName.create('Name')._unsafeUnwrap()).done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

describe('ViewSnapshot', () => {
  it('captures replayable View state without public share credentials', () => {
    const table = buildTable();
    const sharedView = table
      .createView({
        type: 'grid',
        name: 'Shared',
        description: 'Replayable configuration',
        enableShare: true,
        shareId: `shr${'a'.repeat(16)}`,
        shareMeta: { allowCopy: false, submit: { requireLogin: true } },
      })
      ._unsafeUnwrap().view;

    const snapshot = captureViewSnapshot(sharedView)._unsafeUnwrap();

    expect(snapshot.properties).toEqual({
      description: 'Replayable configuration',
      shareMeta: { allowCopy: false, submit: { requireLogin: true } },
    });
    expect(JSON.stringify(snapshot)).not.toContain(sharedView.shareId());
  });

  it('sanitizes credentials from legacy snapshots when rehydrating', () => {
    const table = buildTable();
    const source = table
      .createView({
        type: 'grid',
        name: 'Legacy snapshot',
        shareMeta: { allowCopy: true },
      })
      ._unsafeUnwrap().view;
    const snapshot = captureViewSnapshot(source)._unsafeUnwrap();
    const revokedShareId = `shr${'r'.repeat(16)}`;

    const restored = rehydrateViewSnapshot({
      ...snapshot,
      properties: {
        ...snapshot.properties,
        enableShare: true,
        shareId: revokedShareId,
      },
    })._unsafeUnwrap();

    expect(restored.enableShare()).toBeUndefined();
    expect(restored.shareId()).toBeUndefined();
    expect(restored.shareMeta()).toEqual({ allowCopy: true });
  });
});
