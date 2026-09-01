import { describe, expect, it } from 'vitest';

import { DuplicateBaseByIdCommand } from './DuplicateBaseByIdCommand';

describe('DuplicateBaseByIdCommand', () => {
  it('creates a structure-only command by default', () => {
    const sourceBaseId = `bse${'a'.repeat(16)}`;
    const result = DuplicateBaseByIdCommand.create({ sourceBaseId });

    const command = result._unsafeUnwrap();
    expect(command.sourceBaseId.toString()).toBe(sourceBaseId);
    expect(command.withRecords).toBe(false);
    expect(command.batchSize).toBe(500);
  });

  it('accepts explicit target identity, name and record options', () => {
    const sourceBaseId = `bse${'a'.repeat(16)}`;
    const targetBaseId = `bse${'b'.repeat(16)}`;
    const result = DuplicateBaseByIdCommand.create({
      sourceBaseId,
      targetBaseId,
      name: 'Copy',
      withRecords: true,
      batchSize: 1000,
    });

    const command = result._unsafeUnwrap();
    expect(command.targetBaseId?.toString()).toBe(targetBaseId);
    expect(command.baseName?.toString()).toBe('Copy');
    expect(command.withRecords).toBe(true);
    expect(command.batchSize).toBe(1000);
  });

  it.each([
    { sourceBaseId: 123 },
    { sourceBaseId: `bse${'a'.repeat(16)}`, name: '' },
    { sourceBaseId: `bse${'a'.repeat(16)}`, name: 'x'.repeat(101) },
    { sourceBaseId: `bse${'a'.repeat(16)}`, batchSize: 0 },
    { sourceBaseId: `bse${'a'.repeat(16)}`, unknown: true },
  ])('rejects invalid input %#', (input) => {
    expect(DuplicateBaseByIdCommand.create(input).isErr()).toBe(true);
  });
});
