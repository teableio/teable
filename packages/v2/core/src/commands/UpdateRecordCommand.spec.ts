import { describe, expect, it } from 'vitest';

import { UpdateRecordCommand } from './UpdateRecordCommand';

const tableId = `tbl${'a'.repeat(16)}`;
const recordId = `rec${'b'.repeat(16)}`;

describe('UpdateRecordCommand', () => {
  it('creates command with field values', () => {
    const commandResult = UpdateRecordCommand.create({
      tableId,
      recordId,
      fields: {
        [`fld${'c'.repeat(16)}`]: 'Hello World',
        [`fld${'d'.repeat(16)}`]: 42,
      },
    });

    const command = commandResult._unsafeUnwrap();
    expect(command.tableId.toString()).toBe(tableId);
    expect(command.recordId.toString()).toBe(recordId);
    expect(command.fieldValues.size).toBe(2);
    expect(command.fieldValues.get(`fld${'c'.repeat(16)}`)).toBe('Hello World');
    expect(command.fieldValues.get(`fld${'d'.repeat(16)}`)).toBe(42);
  });

  it('creates command with empty fields', () => {
    const commandResult = UpdateRecordCommand.create({
      tableId,
      recordId,
    });

    const command = commandResult._unsafeUnwrap();
    expect(command.tableId.toString()).toBe(tableId);
    expect(command.recordId.toString()).toBe(recordId);
    expect(command.fieldValues.size).toBe(0);
  });

  it('rejects invalid table ID', () => {
    const commandResult = UpdateRecordCommand.create({
      tableId: 'invalid',
      recordId,
      fields: {},
    });

    expect(commandResult.isErr()).toBe(true);
  });

  it('rejects invalid record ID', () => {
    const commandResult = UpdateRecordCommand.create({
      tableId,
      recordId: 'invalid',
      fields: {},
    });

    expect(commandResult.isErr()).toBe(true);
  });

  it('rejects missing record ID', () => {
    const commandResult = UpdateRecordCommand.create({
      tableId,
      fields: {},
    });

    expect(commandResult.isErr()).toBe(true);
  });
});
