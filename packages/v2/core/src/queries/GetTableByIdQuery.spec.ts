import { describe, expect, it } from 'vitest';

import { BaseId } from '../domain/base/BaseId';
import { TableId } from '../domain/table/TableId';
import { GetTableByIdQuery } from './GetTableByIdQuery';

describe('GetTableByIdQuery', () => {
  it('creates query with validated ids', () => {
    const baseIdResult = BaseId.create(`bse${'a'.repeat(16)}`);
    const tableIdResult = TableId.create(`tbl${'b'.repeat(16)}`);
    [baseIdResult, tableIdResult].forEach((r) => r._unsafeUnwrap());
    baseIdResult._unsafeUnwrap();
    tableIdResult._unsafeUnwrap();

    const queryResult = GetTableByIdQuery.create({
      baseId: baseIdResult._unsafeUnwrap().toString(),
      tableId: tableIdResult._unsafeUnwrap().toString(),
    });
    queryResult._unsafeUnwrap();

    expect(queryResult._unsafeUnwrap().baseId.equals(baseIdResult._unsafeUnwrap())).toBe(true);
    expect(queryResult._unsafeUnwrap().tableId.equals(tableIdResult._unsafeUnwrap())).toBe(true);
  });

  it('rejects invalid input', () => {
    GetTableByIdQuery.create({ baseId: 'bad', tableId: 'bad' })._unsafeUnwrapErr();
    GetTableByIdQuery.create({ baseId: 'bse' + 'a'.repeat(16) })._unsafeUnwrapErr();
  });
});
