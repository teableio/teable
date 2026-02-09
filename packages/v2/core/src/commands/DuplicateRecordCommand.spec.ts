import { describe, expect, it } from 'vitest';

import { DuplicateRecordCommand } from './DuplicateRecordCommand';

const tableId = `tbl${'a'.repeat(16)}`;
const recordId = `rec${'b'.repeat(16)}`;

describe('DuplicateRecordCommand', () => {
  it('creates command with valid tableId and recordId', () => {
    const commandResult = DuplicateRecordCommand.create({
      tableId,
      recordId,
    });

    const command = commandResult._unsafeUnwrap();
    expect(command.tableId.toString()).toBe(tableId);
    expect(command.recordId.toString()).toBe(recordId);
  });

  it('rejects invalid table ID', () => {
    const commandResult = DuplicateRecordCommand.create({
      tableId: 'invalid',
      recordId,
    });

    expect(commandResult.isErr()).toBe(true);
  });

  it('rejects invalid record ID', () => {
    const commandResult = DuplicateRecordCommand.create({
      tableId,
      recordId: 'invalid',
    });

    expect(commandResult.isErr()).toBe(true);
  });

  it('rejects missing table ID', () => {
    const commandResult = DuplicateRecordCommand.create({
      recordId,
    });

    expect(commandResult.isErr()).toBe(true);
  });

  it('rejects missing record ID', () => {
    const commandResult = DuplicateRecordCommand.create({
      tableId,
    });

    expect(commandResult.isErr()).toBe(true);
  });

  it('rejects empty input', () => {
    const commandResult = DuplicateRecordCommand.create({});

    expect(commandResult.isErr()).toBe(true);
  });
});
