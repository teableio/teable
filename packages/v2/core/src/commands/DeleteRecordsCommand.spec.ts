import { describe, expect, it } from 'vitest';

import { DeleteRecordsCommand } from './DeleteRecordsCommand';

describe('DeleteRecordsCommand', () => {
  it('treats repeated explicit record IDs as one deletion target', () => {
    const result = DeleteRecordsCommand.create({
      tableId: `tbl${'a'.repeat(16)}`,
      recordIds: [`rec${'b'.repeat(16)}`, `rec${'c'.repeat(16)}`, `rec${'b'.repeat(16)}`],
    });

    const command = result._unsafeUnwrap();
    expect(command.recordIds?.map((id) => id.toString())).toEqual([
      `rec${'b'.repeat(16)}`,
      `rec${'c'.repeat(16)}`,
    ]);
    expect(command.tableId.toString()).toBe(`tbl${'a'.repeat(16)}`);
  });

  it('returns error on invalid input', () => {
    const result = DeleteRecordsCommand.create({
      tableId: `tbl${'a'.repeat(16)}`,
      recordIds: [],
    });

    expect(result._unsafeUnwrapErr().message).toBe('Invalid DeleteRecordsCommand input');
  });

  it('returns error when record id is invalid', () => {
    const result = DeleteRecordsCommand.create({
      tableId: `tbl${'a'.repeat(16)}`,
      recordIds: ['invalid'],
    });

    expect(result._unsafeUnwrapErr().message).toBe('Invalid recordId in DeleteRecordsCommand');
  });
});
