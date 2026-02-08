import { describe, expect, it } from 'vitest';

import { CreateRecordsCommand } from './CreateRecordsCommand';

const tableId = `tbl${'a'.repeat(16)}`;

describe('CreateRecordsCommand', () => {
  it('creates command with multiple records', () => {
    const commandResult = CreateRecordsCommand.create({
      tableId,
      records: [
        {
          fields: {
            [`fld${'b'.repeat(16)}`]: 'Hello World',
            [`fld${'c'.repeat(16)}`]: 42,
          },
        },
        {
          fields: {
            [`fld${'b'.repeat(16)}`]: 'Second Record',
            [`fld${'c'.repeat(16)}`]: 100,
          },
        },
      ],
    });

    const command = commandResult._unsafeUnwrap();
    expect(command.tableId.toString()).toBe(tableId);
    expect(command.recordsFieldValues.length).toBe(2);

    // First record
    expect(command.recordsFieldValues[0].size).toBe(2);
    expect(command.recordsFieldValues[0].get(`fld${'b'.repeat(16)}`)).toBe('Hello World');
    expect(command.recordsFieldValues[0].get(`fld${'c'.repeat(16)}`)).toBe(42);

    // Second record
    expect(command.recordsFieldValues[1].size).toBe(2);
    expect(command.recordsFieldValues[1].get(`fld${'b'.repeat(16)}`)).toBe('Second Record');
    expect(command.recordsFieldValues[1].get(`fld${'c'.repeat(16)}`)).toBe(100);
  });

  it('creates command with single record', () => {
    const commandResult = CreateRecordsCommand.create({
      tableId,
      records: [
        {
          fields: {
            fld1: 'Single',
          },
        },
      ],
    });

    const command = commandResult._unsafeUnwrap();
    expect(command.recordsFieldValues.length).toBe(1);
    expect(command.recordsFieldValues[0].get('fld1')).toBe('Single');
  });

  it('creates command with records having empty fields', () => {
    const commandResult = CreateRecordsCommand.create({
      tableId,
      records: [{ fields: {} }, { fields: {} }],
    });

    const command = commandResult._unsafeUnwrap();
    expect(command.recordsFieldValues.length).toBe(2);
    expect(command.recordsFieldValues[0].size).toBe(0);
    expect(command.recordsFieldValues[1].size).toBe(0);
  });

  it('rejects empty records array', () => {
    const commandResult = CreateRecordsCommand.create({
      tableId,
      records: [],
    });

    expect(commandResult.isErr()).toBe(true);
    expect(commandResult._unsafeUnwrapErr().message).toContain('Invalid CreateRecordsCommand');
  });

  it('rejects invalid table ID', () => {
    const commandResult = CreateRecordsCommand.create({
      tableId: 'invalid',
      records: [{ fields: {} }],
    });

    expect(commandResult.isErr()).toBe(true);
  });

  it('rejects missing table ID', () => {
    const commandResult = CreateRecordsCommand.create({
      records: [{ fields: {} }],
    });

    expect(commandResult.isErr()).toBe(true);
  });

  it('rejects missing records field', () => {
    const commandResult = CreateRecordsCommand.create({
      tableId,
    });

    expect(commandResult.isErr()).toBe(true);
  });

  it('preserves various value types in fields', () => {
    const now = new Date().toISOString();
    const commandResult = CreateRecordsCommand.create({
      tableId,
      records: [
        {
          fields: {
            fld1: 'text',
            fld2: 123,
            fld3: true,
            fld4: null,
            fld5: ['a', 'b'],
            fld6: now,
          },
        },
      ],
    });

    const command = commandResult._unsafeUnwrap();
    const fields = command.recordsFieldValues[0];
    expect(fields.get('fld1')).toBe('text');
    expect(fields.get('fld2')).toBe(123);
    expect(fields.get('fld3')).toBe(true);
    expect(fields.get('fld4')).toBe(null);
    expect(fields.get('fld5')).toEqual(['a', 'b']);
    expect(fields.get('fld6')).toBe(now);
  });

  it('handles mixed records with different field sets', () => {
    const commandResult = CreateRecordsCommand.create({
      tableId,
      records: [
        {
          fields: {
            fld1: 'value1',
            fld2: 100,
          },
        },
        {
          fields: {
            fld1: 'value2',
            // fld2 is missing
          },
        },
        {
          fields: {
            // fld1 is missing
            fld2: 300,
          },
        },
      ],
    });

    const command = commandResult._unsafeUnwrap();
    expect(command.recordsFieldValues.length).toBe(3);
    expect(command.recordsFieldValues[0].get('fld1')).toBe('value1');
    expect(command.recordsFieldValues[0].get('fld2')).toBe(100);
    expect(command.recordsFieldValues[1].get('fld1')).toBe('value2');
    expect(command.recordsFieldValues[1].has('fld2')).toBe(false);
    expect(command.recordsFieldValues[2].has('fld1')).toBe(false);
    expect(command.recordsFieldValues[2].get('fld2')).toBe(300);
  });

  it('defaults typecast to false', () => {
    const commandResult = CreateRecordsCommand.create({
      tableId,
      records: [{ fields: {} }],
    });

    const command = commandResult._unsafeUnwrap();
    expect(command.typecast).toBe(false);
  });

  it('respects typecast=true', () => {
    const commandResult = CreateRecordsCommand.create({
      tableId,
      records: [{ fields: {} }],
      typecast: true,
    });

    const command = commandResult._unsafeUnwrap();
    expect(command.typecast).toBe(true);
  });

  it('respects typecast=false', () => {
    const commandResult = CreateRecordsCommand.create({
      tableId,
      records: [{ fields: {} }],
      typecast: false,
    });

    const command = commandResult._unsafeUnwrap();
    expect(command.typecast).toBe(false);
  });
});
