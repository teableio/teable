import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { SubmitRecordCommand } from './SubmitRecordCommand';

const tableId = `tbl${'a'.repeat(16)}`;
const formId = `viw${'b'.repeat(16)}`;

describe('SubmitRecordCommand', () => {
  it('does not accept share authority from public input', () => {
    const shareId = randomUUID();
    const command = SubmitRecordCommand.create({
      tableId,
      formId,
      shareId,
      includeHiddenField: true,
      options: { shareId },
    })._unsafeUnwrap();

    expect(command.shareId).toBeUndefined();
  });

  it('accepts share identity only from server options', () => {
    const shareId = randomUUID();
    const command = SubmitRecordCommand.create(
      { tableId, formId, shareId: randomUUID() },
      { shareId }
    )._unsafeUnwrap();

    expect(command.shareId).toBe(shareId);
  });

  it('creates command with valid input', () => {
    const commandResult = SubmitRecordCommand.create({
      tableId,
      formId,
      fields: {
        [`fld${'c'.repeat(16)}`]: 'Hello',
      },
      typecast: true,
    });

    const command = commandResult._unsafeUnwrap();
    expect(command.tableId.toString()).toBe(tableId);
    expect(command.formId.toString()).toBe(formId);
    expect(command.fieldValues.get(`fld${'c'.repeat(16)}`)).toBe('Hello');
    expect(command.typecast).toBe(true);
  });

  it('rejects invalid formId', () => {
    const commandResult = SubmitRecordCommand.create({
      tableId,
      formId: 'invalid',
      fields: {},
    });

    expect(commandResult.isErr()).toBe(true);
  });

  it('defaults typecast to false', () => {
    const commandResult = SubmitRecordCommand.create({
      tableId,
      formId,
      fields: {},
    });

    const command = commandResult._unsafeUnwrap();
    expect(command.typecast).toBe(false);
  });
});
