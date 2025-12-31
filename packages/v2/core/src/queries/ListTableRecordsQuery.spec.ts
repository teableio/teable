import { describe, expect, it } from 'vitest';

import { BaseId } from '../domain/base/BaseId';
import { TableId } from '../domain/table/TableId';
import { ListTableRecordsQuery } from './ListTableRecordsQuery';

const baseId = (seed: string) => BaseId.create(`bse${seed.repeat(16)}`)._unsafeUnwrap();
const tableId = (seed: string) => TableId.create(`tbl${seed.repeat(16)}`)._unsafeUnwrap();

describe('ListTableRecordsQuery', () => {
  it('builds query from valid input', () => {
    const base = baseId('a');
    const table = tableId('a');
    const result = ListTableRecordsQuery.create({
      baseId: base.toString(),
      tableId: table.toString(),
      filter: null,
    });
    expect(result.isOk()).toBe(true);
    const query = result._unsafeUnwrap();
    expect(query.baseId.equals(base)).toBe(true);
    expect(query.tableId.equals(table)).toBe(true);
    expect(query.filter).toBeNull();
  });

  it('rejects invalid ids', () => {
    const invalid = ListTableRecordsQuery.create({
      baseId: 'bad',
      tableId: 'bad',
    });
    expect(invalid.isErr()).toBe(true);
  });

  it('rejects invalid filter shapes', () => {
    const invalidFilter = ListTableRecordsQuery.create({
      baseId: baseId('b').toString(),
      tableId: tableId('b').toString(),
      filter: {
        fieldId: 'fld123',
        operator: 'isEmpty',
        value: 'nope',
      },
    });
    expect(invalidFilter.isErr()).toBe(true);
  });
});
