import { describe, expect, it } from 'vitest';

import { ImportDotTeaStructureCommand } from './ImportDotTeaStructureCommand';

const baseId = `bse${'c'.repeat(16)}`;

describe('ImportDotTeaStructureCommand', () => {
  it('creates from buffer source', () => {
    const result = ImportDotTeaStructureCommand.createFromBuffer({
      baseId,
      dotTeaData: new Uint8Array([1, 2, 3]),
    });

    expect(result.isOk()).toBe(true);
    const command = result._unsafeUnwrap();
    expect(command.source.type).toBe('buffer');
  });

  it('requires path for path source', () => {
    const result = ImportDotTeaStructureCommand.createFromPath({
      baseId,
      path: '',
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('dottea.path_missing');
  });
});
