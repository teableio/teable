import { describe, expect, it } from 'vitest';

import { CreateRecordsStreamCommand } from './CreateRecordsStreamCommand';

describe('CreateRecordsStreamCommand', () => {
  it('creates command from json input with defaults', () => {
    const fieldId = `fld${'a'.repeat(16)}`;
    const commandResult = CreateRecordsStreamCommand.create({
      tableId: `tbl${'b'.repeat(16)}`,
      records: [{ fields: { [fieldId]: 'value' } }],
    });

    const command = commandResult._unsafeUnwrap();
    const entries = [...command.recordsFieldValues];

    expect(command.tableId.toString()).toBe(`tbl${'b'.repeat(16)}`);
    expect(command.batchSize).toBe(500);
    expect(entries[0]?.get(fieldId)).toBe('value');
  });

  it('rejects invalid json input', () => {
    const commandResult = CreateRecordsStreamCommand.create({
      tableId: `tbl${'b'.repeat(16)}`,
      batchSize: 0,
      records: [{ fields: {} }],
    });

    expect(commandResult._unsafeUnwrapErr().message).toBe(
      'Invalid CreateRecordsStreamCommand input'
    );
  });

  it('creates command from iterable input', () => {
    const fieldId = `fld${'c'.repeat(16)}`;
    const commandResult = CreateRecordsStreamCommand.createFromIterable({
      tableId: `tbl${'d'.repeat(16)}`,
      records: [{ fields: { [fieldId]: 'value' } }],
    });

    const command = commandResult._unsafeUnwrap();
    const entries = [...command.recordsFieldValues];

    expect(command.batchSize).toBe(500);
    expect(entries[0]?.get(fieldId)).toBe('value');
  });

  it('rejects invalid batch size for iterable input', () => {
    const commandResult = CreateRecordsStreamCommand.createFromIterable({
      tableId: `tbl${'d'.repeat(16)}`,
      records: [],
      batchSize: 6000,
    });

    expect(commandResult._unsafeUnwrapErr().message).toBe('batchSize must be between 1 and 5000');
  });
});
