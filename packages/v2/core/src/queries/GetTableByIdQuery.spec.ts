import { describe, expect, it } from 'vitest';

import { BaseId } from '../domain/base/BaseId';
import { TableId } from '../domain/table/TableId';
import { GetTableByIdQuery } from './GetTableByIdQuery';

describe('GetTableByIdQuery', () => {
  it('creates query with validated ids', () => {
    const baseIdResult = BaseId.create(`bse${'a'.repeat(16)}`);
    const tableIdResult = TableId.create(`tbl${'b'.repeat(16)}`);
    expect([baseIdResult, tableIdResult].every((r) => r.isOk())).toBe(true);
    if (baseIdResult.isErr() || tableIdResult.isErr()) return;

    const queryResult = GetTableByIdQuery.create({
      baseId: baseIdResult.value.toString(),
      tableId: tableIdResult.value.toString(),
    });
    expect(queryResult.isOk()).toBe(true);
    if (queryResult.isErr()) return;

    expect(queryResult.value.baseId.equals(baseIdResult.value)).toBe(true);
    expect(queryResult.value.tableId.equals(tableIdResult.value)).toBe(true);
  });

  it('rejects invalid input', () => {
    expect(GetTableByIdQuery.create({ baseId: 'bad', tableId: 'bad' }).isErr()).toBe(true);
    expect(GetTableByIdQuery.create({ baseId: 'bse' + 'a'.repeat(16) }).isErr()).toBe(true);
  });
});
