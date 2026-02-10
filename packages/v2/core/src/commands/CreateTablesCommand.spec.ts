import { describe, expect, it } from 'vitest';

import { CreateTablesCommand } from './CreateTablesCommand';

describe('CreateTablesCommand', () => {
  it('creates command with multiple tables', () => {
    const baseId = `bse${'a'.repeat(16)}`;
    const tableId = `tbl${'b'.repeat(16)}`;
    const result = CreateTablesCommand.create({
      baseId,
      tables: [{ name: 'First Table' }, { tableId, name: 'Second Table' }],
    });

    const command = result._unsafeUnwrap();
    expect(command.tables).toHaveLength(2);
    expect(command.tables[1]?.tableId?.toString()).toBe(tableId);
  });

  it('rejects duplicate table ids', () => {
    const baseId = `bse${'c'.repeat(16)}`;
    const tableId = `tbl${'d'.repeat(16)}`;
    const result = CreateTablesCommand.create({
      baseId,
      tables: [
        { tableId, name: 'Table A' },
        { tableId, name: 'Table B' },
      ],
    });

    result._unsafeUnwrapErr();
    expect(result._unsafeUnwrapErr().message).toContain('Duplicate tableId');
  });
});
