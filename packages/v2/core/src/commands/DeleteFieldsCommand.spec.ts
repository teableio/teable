import { describe, expect, it } from 'vitest';

import { DeleteFieldsCommand } from './DeleteFieldsCommand';

const baseId = `bse${'a'.repeat(16)}`;
const tableId = `tbl${'b'.repeat(16)}`;
const fieldIdA = `fld${'c'.repeat(16)}`;
const fieldIdB = `fld${'d'.repeat(16)}`;

describe('DeleteFieldsCommand', () => {
  it('creates a command and dedupes field ids while preserving order', () => {
    const commandResult = DeleteFieldsCommand.create({
      baseId,
      tableId,
      fieldIds: [fieldIdA, fieldIdB, fieldIdA],
    });

    expect(commandResult.isOk()).toBe(true);
    if (commandResult.isErr()) {
      return;
    }

    const command = commandResult.value;
    expect(command.baseId.toString()).toBe(baseId);
    expect(command.tableId.toString()).toBe(tableId);
    expect(command.fieldIds.map((fieldId) => fieldId.toString())).toEqual([fieldIdA, fieldIdB]);
  });

  it('rejects invalid input', () => {
    const commandResult = DeleteFieldsCommand.create({
      baseId,
      tableId,
      fieldIds: [],
    });

    expect(commandResult.isErr()).toBe(true);
  });
});
