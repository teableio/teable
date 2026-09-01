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
      projection: JSON.stringify([]),
      includeTotal: false,
      viewId: `viw${'d'.repeat(16)}`,
      ignoreViewQuery: true,
    });

    expect(result.isOk()).toBe(true);
    const query = result._unsafeUnwrap();
    expect(query.filterLinkCellCandidate).toEqual([`fld${'a'.repeat(16)}`, `rec${'b'.repeat(16)}`]);
    expect(query.selectedRecordIds).toEqual([`rec${'c'.repeat(16)}`]);
    expect(query.projection).toEqual([]);
    expect(query.includeTotal).toBe(false);
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

  it('applies a bounded group metadata limit to public requests', () => {
    const result = ListTableRecordsQuery.create({
      tableId: createTableId('f').toString(),
      groupBy: [`fld${'a'.repeat(16)}`],
      includeGroups: true,
    });

    expect(result.isOk()).toBe(true);
    const query = result._unsafeUnwrap();
    expect(query.includeGroupMetadata).toBe(true);
    expect(query.groupLimit).toBe(5_000);
  });

  it('preserves a trusted host group metadata limit', () => {
    const result = ListTableRecordsQuery.create(
      {
        tableId: createTableId('g').toString(),
      },
      {
        includeGroupMetadata: true,
        groupLimit: 25,
      }
    );

    expect(result.isOk()).toBe(true);
    const query = result._unsafeUnwrap();
    expect(query.includeGroupMetadata).toBe(true);
    expect(query.groupLimit).toBe(25);
  });

  it('does not apply a group limit when group metadata is disabled', () => {
    const result = ListTableRecordsQuery.create(
      {
        tableId: createTableId('h').toString(),
        includeGroups: false,
      },
      {
        includeGroupMetadata: true,
        groupLimit: 25,
      }
    );

    expect(result.isOk()).toBe(true);
    const query = result._unsafeUnwrap();
    expect(query.includeGroupMetadata).toBe(false);
    expect(query.groupLimit).toBeUndefined();
  });

  describe('idsOnly page size', () => {
    const base = { tableId: `tbl${'a'.repeat(16)}`, fieldKeyType: 'id' as const };

    it('overrides the public limit cap for ids-only sweeps', () => {
      const query = ListTableRecordsQuery.create(
        { ...base, limit: 1000, offset: 0 },
        { idsOnly: true, idsOnlyPageSize: 10_000 }
      )._unsafeUnwrap();

      expect(query.pagination.limit().toNumber()).toBe(10_000);
      expect(query.idsOnly).toBe(true);
    });

    it('ignores the host page size when idsOnly is not set', () => {
      const query = ListTableRecordsQuery.create(
        { ...base, limit: 1000, offset: 0 },
        { idsOnlyPageSize: 10_000 }
      )._unsafeUnwrap();

      expect(query.pagination.limit().toNumber()).toBe(1000);
    });

    it('still rejects a request limit above the public cap', () => {
      const result = ListTableRecordsQuery.create({ ...base, limit: 10_000 });
      expect(result.isErr()).toBe(true);
    });
  });
});
