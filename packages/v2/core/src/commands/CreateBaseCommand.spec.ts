import { describe, expect, it } from 'vitest';

import { CreateBaseCommand } from './CreateBaseCommand';

describe('CreateBaseCommand', () => {
  it('creates commands with optional base id', () => {
    const result = CreateBaseCommand.create({
      baseId: `bse${'a'.repeat(16)}`,
      name: 'Workspace',
    });

    const command = result._unsafeUnwrap();
    expect(command.baseId?.toString()).toBe(`bse${'a'.repeat(16)}`);
    expect(command.baseName.toString()).toBe('Workspace');
  });

  it('validates input schema', () => {
    const result = CreateBaseCommand.create({ name: '' });
    expect(result.isErr()).toBe(true);
  });
});
