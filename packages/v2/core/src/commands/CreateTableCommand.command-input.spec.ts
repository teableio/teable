import { CreateTableCommand, Table } from '@teable/v2-core';
import { describe, expect, it } from 'vitest';

describe('CreateTableCommand', () => {
  it('defaults fields and views when missing', () => {
    const commandResult = CreateTableCommand.create({
      baseId: `bse${'a'.repeat(16)}`,
      name: 'Projects',
      fields: [],
    });

    commandResult._unsafeUnwrap();

    const command = commandResult._unsafeUnwrap();
    const builder = Table.builder().withBaseId(command.baseId).withName(command.tableName);
    for (const field of command.fields) {
      field.applyTo(builder);
    }
    for (const view of command.views) {
      view.applyTo(builder);
    }

    const tableResult = builder.build();
    tableResult._unsafeUnwrap();

    const table = tableResult._unsafeUnwrap();
    expect(table.getFields().length).toBe(1);
    expect(table.getFields()[0]?.name().toString()).toBe('Name');
    expect(table.views().length).toBe(1);
    expect(table.views()[0]?.name().toString()).toBe('Grid');
  });

  it('rejects invalid input', () => {
    const result = CreateTableCommand.create({ name: 'Bad' });
    result._unsafeUnwrapErr();
  });

  it('rejects multiple primary fields', () => {
    const result = CreateTableCommand.create({
      baseId: `bse${'b'.repeat(16)}`,
      name: 'Invalid',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'longText', name: 'Notes', isPrimary: true },
      ],
    });
    result._unsafeUnwrapErr();
  });
});
