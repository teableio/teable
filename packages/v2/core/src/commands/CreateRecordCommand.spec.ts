import { describe, expect, it } from 'vitest';

import { CreateRecordCommand } from './CreateRecordCommand';

const tableId = `tbl${'a'.repeat(16)}`;

describe('CreateRecordCommand', () => {
  it('creates command with field values', () => {
    const commandResult = CreateRecordCommand.create({
      tableId,
      fields: {
        [`fld${'b'.repeat(16)}`]: 'Hello World',
        [`fld${'c'.repeat(16)}`]: 42,
      },
    });

    const command = commandResult._unsafeUnwrap();
    expect(command.tableId.toString()).toBe(tableId);
    expect(command.fieldValues.size).toBe(2);
    expect(command.fieldValues.get(`fld${'b'.repeat(16)}`)).toBe('Hello World');
    expect(command.fieldValues.get(`fld${'c'.repeat(16)}`)).toBe(42);
  });

  it('creates command with empty fields', () => {
    const commandResult = CreateRecordCommand.create({
      tableId,
    });

    const command = commandResult._unsafeUnwrap();
    expect(command.tableId.toString()).toBe(tableId);
    expect(command.fieldValues.size).toBe(0);
  });

  it('creates command with explicit empty fields object', () => {
    const commandResult = CreateRecordCommand.create({
      tableId,
      fields: {},
    });

    const command = commandResult._unsafeUnwrap();
    expect(command.fieldValues.size).toBe(0);
  });

  it('rejects invalid table ID', () => {
    const commandResult = CreateRecordCommand.create({
      tableId: 'invalid',
      fields: {},
    });

    expect(commandResult.isErr()).toBe(true);
  });

  it('rejects missing table ID', () => {
    const commandResult = CreateRecordCommand.create({
      fields: {},
    });

    expect(commandResult.isErr()).toBe(true);
  });

  it('preserves various value types in fields', () => {
    const now = new Date().toISOString();
    const commandResult = CreateRecordCommand.create({
      tableId,
      fields: {
        fld1: 'text',
        fld2: 123,
        fld3: true,
        fld4: null,
        fld5: ['a', 'b'],
        fld6: now,
      },
    });

    const command = commandResult._unsafeUnwrap();
    expect(command.fieldValues.get('fld1')).toBe('text');
    expect(command.fieldValues.get('fld2')).toBe(123);
    expect(command.fieldValues.get('fld3')).toBe(true);
    expect(command.fieldValues.get('fld4')).toBe(null);
    expect(command.fieldValues.get('fld5')).toEqual(['a', 'b']);
    expect(command.fieldValues.get('fld6')).toBe(now);
  });

  it('defaults source to user', () => {
    const commandResult = CreateRecordCommand.create({
      tableId,
      fields: {
        [`fld${'d'.repeat(16)}`]: 'Hello',
      },
      fieldKeyType: 'id',
    });

    const command = commandResult._unsafeUnwrap();
    expect(command.source).toEqual({ type: 'user' });
  });
});
