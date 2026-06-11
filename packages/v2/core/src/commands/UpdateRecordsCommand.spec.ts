import { describe, expect, it } from 'vitest';

import { UpdateRecordsCommand } from './UpdateRecordsCommand';

const tableId = `tbl${'a'.repeat(16)}`;
const textFieldId = `fld${'b'.repeat(16)}`;
const numberFieldId = `fld${'c'.repeat(16)}`;

describe('UpdateRecordsCommand', () => {
  it('creates command with explicit record updates and order', () => {
    const recordIdA = `rec${'d'.repeat(16)}`;
    const recordIdB = `rec${'e'.repeat(16)}`;
    const viewId = `viw${'f'.repeat(16)}`;

    const commandResult = UpdateRecordsCommand.create({
      tableId,
      records: [
        {
          id: recordIdA,
          fields: {
            [numberFieldId]: 42,
          },
        },
        {
          id: recordIdB,
          fields: {
            [textFieldId]: 'updated',
          },
        },
      ],
      order: {
        viewId,
        anchorId: recordIdA,
        position: 'after',
      },
      fieldKeyType: 'id',
    });

    const command = commandResult._unsafeUnwrap();
    expect(command.records?.map((record) => record.recordId.toString())).toEqual([
      recordIdA,
      recordIdB,
    ]);
    expect(command.records?.[0]?.fieldValues.get(numberFieldId)).toBe(42);
    expect(command.records?.[1]?.fieldValues.get(textFieldId)).toBe('updated');
    expect(command.order?.viewId.toString()).toBe(viewId);
  });

  it('creates command with field values and filter', () => {
    const commandResult = UpdateRecordsCommand.create({
      tableId,
      fields: {
        [numberFieldId]: 42,
      },
      filter: {
        fieldId: textFieldId,
        operator: 'contains',
        value: 'task',
      },
      fieldKeyType: 'id',
    });

    const command = commandResult._unsafeUnwrap();
    expect(command.tableId.toString()).toBe(tableId);
    expect(command.fieldValues.get(numberFieldId)).toBe(42);
    expect(command.filter).toEqual({
      fieldId: textFieldId,
      operator: 'contains',
      value: 'task',
    });
  });

  it('creates command with explicit recordIds', () => {
    const recordIdA = `rec${'d'.repeat(16)}`;
    const recordIdB = `rec${'e'.repeat(16)}`;
    const commandResult = UpdateRecordsCommand.create({
      tableId,
      fields: {
        [numberFieldId]: 42,
      },
      recordIds: [recordIdA, recordIdB],
    });

    const command = commandResult._unsafeUnwrap();
    expect(command.recordIds?.map((recordId) => recordId.toString())).toEqual([
      recordIdA,
      recordIdB,
    ]);
    expect(command.filter).toBeUndefined();
  });

  it('defaults fieldKeyType to id', () => {
    const commandResult = UpdateRecordsCommand.create({
      tableId,
      fields: {
        [numberFieldId]: 42,
      },
      filter: {
        fieldId: textFieldId,
        operator: 'is',
        value: 'task',
      },
    });

    expect(commandResult._unsafeUnwrap().fieldKeyType).toBe('id');
  });

  it('rejects missing selector', () => {
    const commandResult = UpdateRecordsCommand.create({
      tableId,
      fields: {
        [numberFieldId]: 42,
      },
    });

    expect(commandResult.isErr()).toBe(true);
  });

  it('rejects empty recordIds', () => {
    const commandResult = UpdateRecordsCommand.create({
      tableId,
      fields: {
        [numberFieldId]: 42,
      },
      recordIds: [],
    });

    expect(commandResult.isErr()).toBe(true);
  });

  it('rejects null filter', () => {
    const commandResult = UpdateRecordsCommand.create({
      tableId,
      fields: {
        [numberFieldId]: 42,
      },
      filter: null,
    });

    expect(commandResult.isErr()).toBe(true);
  });

  it('rejects ambiguous selectors', () => {
    const commandResult = UpdateRecordsCommand.create({
      tableId,
      fields: {
        [numberFieldId]: 42,
      },
      filter: {
        fieldId: textFieldId,
        operator: 'contains',
        value: 'task',
      },
      recordIds: [`rec${'f'.repeat(16)}`],
    });

    expect(commandResult.isErr()).toBe(true);
  });

  it('rejects mixed explicit records and shared selector inputs', () => {
    const commandResult = UpdateRecordsCommand.create({
      tableId,
      records: [
        {
          id: `rec${'a'.repeat(16)}`,
          fields: {
            [numberFieldId]: 42,
          },
        },
      ],
      recordIds: [`rec${'b'.repeat(16)}`],
      fieldKeyType: 'id',
    });

    expect(commandResult.isErr()).toBe(true);
  });

  it('rejects order without explicit records', () => {
    const commandResult = UpdateRecordsCommand.create({
      tableId,
      fields: {
        [numberFieldId]: 42,
      },
      recordIds: [`rec${'a'.repeat(16)}`],
      order: {
        viewId: `viw${'b'.repeat(16)}`,
        anchorId: `rec${'c'.repeat(16)}`,
        position: 'after',
      },
      fieldKeyType: 'id',
    });

    expect(commandResult.isErr()).toBe(true);
  });

  it('rejects duplicate explicit record ids', () => {
    const duplicateRecordId = `rec${'a'.repeat(16)}`;
    const commandResult = UpdateRecordsCommand.create({
      tableId,
      records: [
        {
          id: duplicateRecordId,
          fields: {
            [numberFieldId]: 42,
          },
        },
        {
          id: duplicateRecordId,
          fields: {
            [textFieldId]: 'again',
          },
        },
      ],
      fieldKeyType: 'id',
    });

    expect(commandResult.isErr()).toBe(true);
  });

  it('rejects empty filter groups', () => {
    const commandResult = UpdateRecordsCommand.create({
      tableId,
      fields: {
        [numberFieldId]: 42,
      },
      filter: {
        conjunction: 'and',
        items: [],
      },
    });

    expect(commandResult.isErr()).toBe(true);
  });
});
