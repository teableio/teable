import { describe, expect, it } from 'vitest';

import { requireStoredRecordSnapshots } from './RecordMutationSnapshotContract';

describe('RecordMutationSnapshotContract', () => {
  it('returns unavailable when the repository omits stored snapshots entirely', () => {
    const result = requireStoredRecordSnapshots(
      {
        operation: 'create',
        tableId: 'tblTest',
        expectedCount: 1,
      },
      undefined
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('record.stored_snapshot.unavailable');
  });

  it('returns missing when capture runs but yields no stored rows', () => {
    const result = requireStoredRecordSnapshots(
      {
        operation: 'delete',
        tableId: 'tblTest',
        expectedCount: 1,
      },
      []
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('record.stored_snapshot.missing');
  });
});
