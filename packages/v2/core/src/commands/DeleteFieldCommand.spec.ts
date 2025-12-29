import { describe, expect, it } from 'vitest';

import { DeleteFieldCommand } from './DeleteFieldCommand';

const baseId = `bse${'a'.repeat(16)}`;
const tableId = `tbl${'b'.repeat(16)}`;
const fieldId = `fld${'c'.repeat(16)}`;

describe('DeleteFieldCommand', () => {
  it('creates command with ids', () => {
    const commandResult = DeleteFieldCommand.create({
      baseId,
      tableId,
      fieldId,
    });

    commandResult._unsafeUnwrap();

    const command = commandResult._unsafeUnwrap();
    expect(command.baseId.toString()).toBe(baseId);
    expect(command.tableId.toString()).toBe(tableId);
    expect(command.fieldId.toString()).toBe(fieldId);
  });

  it('rejects invalid input', () => {
    const commandResult = DeleteFieldCommand.create({
      baseId,
      tableId,
    });

    commandResult._unsafeUnwrapErr();
  });
});
