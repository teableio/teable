import { describe, expect, it } from 'vitest';

import { ArchiveRecordsCommand } from './ArchiveRecordsCommand';

const input = {
  tableId: `tbl${'a'.repeat(16)}`,
  recordIds: [`rec${'b'.repeat(16)}`],
};

describe('ArchiveRecordsCommand recording intent', () => {
  it('does not accept recording boundaries from the public request', () => {
    const command = ArchiveRecordsCommand.create({
      ...input,
      groupId: 'untrusted-stream',
      groupPosition: 'continue',
    })._unsafeUnwrap();
    expect(command.undoGroup).toEqual({});
  });
});
