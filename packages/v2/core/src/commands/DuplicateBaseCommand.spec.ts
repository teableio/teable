import { describe, expect, it } from 'vitest';

import { DuplicateBaseCommand } from './DuplicateBaseCommand';

const baseId = `bse${'d'.repeat(16)}`;

describe('DuplicateBaseCommand', () => {
  it('allows duplicating an empty base structure', () => {
    const result = DuplicateBaseCommand.createFromSource({
      baseId,
      source: {
        structure: {
          id: `bse${'s'.repeat(16)}`,
          tables: [],
        },
        records: async function* () {
          yield undefined as never;
        },
      },
      withRecords: true,
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().source.structure.tables).toHaveLength(0);
  });
});
