import { describe, expect, it } from 'vitest';

import { TableId } from '../domain/table/TableId';
import { ListTableRecordsQuery } from './ListTableRecordsQuery';

const createTableId = (seed: string) => TableId.create(`tbl${seed.repeat(16)}`)._unsafeUnwrap();

describe('ListTableRecordsQuery', () => {
  it('builds query from valid input', () => {
    const table = createTableId('a');
    const result = ListTableRecordsQuery.create({
      tableId: table.toString(),
      filter: null,
    });
    expect(result.isOk()).toBe(true);
    const query = result._unsafeUnwrap();
    expect(query.tableId.equals(table)).toBe(true);
    expect(query.filter).toBeNull();
  });

  it('rejects invalid ids', () => {
    const invalid = ListTableRecordsQuery.create({
      tableId: 'bad',
    });
    expect(invalid.isErr()).toBe(true);
  });

  it('rejects invalid filter shapes', () => {
    const invalidFilter = ListTableRecordsQuery.create({
      tableId: createTableId('b').toString(),
      filter: {
        fieldId: 'fld123',
        operator: 'isEmpty',
        value: 'nope',
      },
    });
    expect(invalidFilter.isErr()).toBe(true);
  });
});
