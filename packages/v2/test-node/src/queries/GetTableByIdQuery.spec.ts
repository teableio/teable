import { GetTableByIdQuery } from '@teable/v2-core';
import { describe, expect, it } from 'vitest';

describe('GetTableByIdQuery', () => {
  it('creates queries from valid input', () => {
    const result = GetTableByIdQuery.create({
      baseId: `bse${'a'.repeat(16)}`,
      tableId: `tbl${'a'.repeat(16)}`,
    });
    expect(result.isOk()).toBe(true);
  });

  it('rejects invalid input', () => {
    expect(GetTableByIdQuery.create({ baseId: 1, tableId: 'tbl' }).isErr()).toBe(true);
    expect(GetTableByIdQuery.create({ baseId: 'bad', tableId: 'bad' }).isErr()).toBe(true);
  });
});
