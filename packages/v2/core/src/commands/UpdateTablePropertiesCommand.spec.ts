import { describe, expect, it } from 'vitest';

import { UpdateTablePropertiesCommand } from './UpdateTablePropertiesCommand';

const baseId = `bse${'a'.repeat(16)}`;
const tableId = `tbl${'a'.repeat(16)}`;

describe('UpdateTablePropertiesCommand', () => {
  it('creates a partial table properties patch', () => {
    const command = UpdateTablePropertiesCommand.create({
      baseId,
      tableId,
      description: 'Projects tracked by the team',
    })._unsafeUnwrap();

    expect(command.patch).toEqual({ description: 'Projects tracked by the team' });
  });

  it('accepts null to clear table properties', () => {
    const command = UpdateTablePropertiesCommand.create({
      baseId,
      tableId,
      description: null,
      icon: null,
    })._unsafeUnwrap();

    expect(command.patch).toEqual({ description: null, icon: null });
  });

  it.each([
    { baseId, tableId },
    { baseId, tableId, icon: 'not-an-emoji' },
    { baseId, tableId, description: 'x'.repeat(2_001) },
    { baseId, tableId, description: 'Description', unknown: true },
  ])('rejects invalid input %#', (input) => {
    expect(UpdateTablePropertiesCommand.create(input).isErr()).toBe(true);
  });
});
