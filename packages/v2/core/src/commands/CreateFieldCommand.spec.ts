import { describe, expect, it } from 'vitest';

import { CreateFieldCommand } from './CreateFieldCommand';

const baseId = `bse${'a'.repeat(16)}`;
const tableId = `tbl${'b'.repeat(16)}`;

describe('CreateFieldCommand', () => {
  it('creates command with a field payload', () => {
    const commandResult = CreateFieldCommand.create({
      baseId,
      tableId,
      field: {
        type: 'singleLineText',
        name: 'Title',
        options: { defaultValue: 'Hello' },
      },
    });

    expect(commandResult.isOk()).toBe(true);
    if (commandResult.isErr()) return;

    const command = commandResult.value;
    expect(command.baseId.toString()).toBe(baseId);
    expect(command.tableId.toString()).toBe(tableId);
    expect(command.field.name().toString()).toBe('Title');
    expect(command.field.type().toString()).toBe('singleLineText');
  });

  it('rejects primary field updates', () => {
    const commandResult = CreateFieldCommand.create({
      baseId,
      tableId,
      field: {
        type: 'singleLineText',
        name: 'Primary',
        isPrimary: true,
      },
    });

    expect(commandResult.isErr()).toBe(true);
  });
});
