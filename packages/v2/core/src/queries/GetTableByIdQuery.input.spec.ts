import { GetTableByIdQuery } from '@teable/v2-core';
import { describe, it } from 'vitest';

describe('GetTableByIdQuery', () => {
  it('creates queries from valid input', () => {
    const result = GetTableByIdQuery.create({
      baseId: `bse${'a'.repeat(16)}`,
      tableId: `tbl${'a'.repeat(16)}`,
    });
    result._unsafeUnwrap();
  });

  it('rejects invalid input', () => {
    GetTableByIdQuery.create({ baseId: 1, tableId: 'tbl' })._unsafeUnwrapErr();
    GetTableByIdQuery.create({ baseId: 'bad', tableId: 'bad' })._unsafeUnwrapErr();
  });
});
