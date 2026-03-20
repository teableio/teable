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

  it('accepts unary operators without explicit value in JSON filter input', () => {
    const tableId = createTableId('c').toString();
    const result = ListTableRecordsQuery.create({
      tableId,
      filter: JSON.stringify({
        fieldId: 'fld123',
        operator: 'isNotEmpty',
      }),
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk() && result.value.filter && 'fieldId' in result.value.filter) {
      expect(result.value.filter.value).toBeNull();
    }
  });

  it('accepts advanced selection inputs', () => {
    const tableId = createTableId('d').toString();
    const result = ListTableRecordsQuery.create({
      tableId,
      filterLinkCellCandidate: JSON.stringify([`fld${'a'.repeat(16)}`, `rec${'b'.repeat(16)}`]),
      selectedRecordIds: JSON.stringify([`rec${'c'.repeat(16)}`]),
      viewId: `viw${'d'.repeat(16)}`,
      ignoreViewQuery: true,
    });

    expect(result.isOk()).toBe(true);
    const query = result._unsafeUnwrap();
    expect(query.filterLinkCellCandidate).toEqual([`fld${'a'.repeat(16)}`, `rec${'b'.repeat(16)}`]);
    expect(query.selectedRecordIds).toEqual([`rec${'c'.repeat(16)}`]);
    expect(query.viewId).toBe(`viw${'d'.repeat(16)}`);
    expect(query.ignoreViewQuery).toBe(true);
  });

  it('rejects mutually exclusive advanced link filters', () => {
    const result = ListTableRecordsQuery.create({
      tableId: createTableId('e').toString(),
      filterLinkCellSelected: `fld${'a'.repeat(16)}`,
      filterLinkCellCandidate: `fld${'b'.repeat(16)}`,
    });

    expect(result.isErr()).toBe(true);
  });
});
