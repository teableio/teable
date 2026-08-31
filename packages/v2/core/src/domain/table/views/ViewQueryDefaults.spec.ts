import { describe, expect, it } from 'vitest';

import type { RecordFilter } from '../../../queries/RecordFilterDto';
import { ViewQueryDefaults } from './ViewQueryDefaults';

describe('ViewQueryDefaults', () => {
  it('merges default and query filters with AND', () => {
    const defaultFilter: RecordFilter = {
      fieldId: 'fldDefault',
      operator: 'is',
      value: 'A',
    };
    const queryFilter: RecordFilter = {
      fieldId: 'fldExtra',
      operator: 'isNot',
      value: 'B',
    };

    const defaults = ViewQueryDefaults.create({ filter: defaultFilter })._unsafeUnwrap();
    const merged = defaults.merge({ filter: queryFilter });

    expect(merged.filter()).toEqual({
      conjunction: 'and',
      items: [defaultFilter, queryFilter],
    });
  });

  it('uses default filter when query filter is undefined', () => {
    const defaultFilter: RecordFilter = {
      fieldId: 'fldDefault',
      operator: 'contains',
      value: 'A',
    };

    const defaults = ViewQueryDefaults.create({ filter: defaultFilter })._unsafeUnwrap();
    const merged = defaults.merge({});

    expect(merged.filter()).toEqual(defaultFilter);
  });

  it('clears filter when query filter is null', () => {
    const defaultFilter: RecordFilter = {
      fieldId: 'fldDefault',
      operator: 'contains',
      value: 'A',
    };

    const defaults = ViewQueryDefaults.create({ filter: defaultFilter })._unsafeUnwrap();
    const merged = defaults.merge({ filter: null });

    expect(merged.filter()).toBeNull();
  });

  it('keeps the lossless source filter separate from the canonical filter', () => {
    const canonicalFilter: RecordFilter = {
      fieldId: 'fldDefault',
      operator: 'isAnyOf',
      value: ['A'],
    };
    const sourceFilter = {
      conjunction: 'and',
      filterSet: [{ fieldId: 'fldDefault', operator: 'IN', isSymbol: true, value: 'A' }],
    };

    const defaults = ViewQueryDefaults.create(
      { filter: canonicalFilter },
      { sourceFilter }
    )._unsafeUnwrap();

    const derivedCanonicalFilter = {
      conjunction: 'and' as const,
      items: [canonicalFilter],
    };
    expect(defaults.filter()).toEqual(derivedCanonicalFilter);
    expect(defaults.sourceFilter()).toEqual(sourceFilter);
    expect(defaults.toDto()).toEqual({ filter: derivedCanonicalFilter });
  });

  it('owns immutable copies of the source filter', () => {
    const sourceFilter = {
      conjunction: 'and' as const,
      filterSet: [
        {
          fieldId: 'fldDefault',
          operator: 'IN' as const,
          isSymbol: true as const,
          value: 'A',
        },
      ],
    };
    const defaults = ViewQueryDefaults.create({}, { sourceFilter })._unsafeUnwrap();

    sourceFilter.filterSet[0]!.value = 'mutated input';
    expect(defaults.sourceFilter()).toEqual({
      conjunction: 'and',
      filterSet: [
        {
          fieldId: 'fldDefault',
          operator: 'IN',
          isSymbol: true,
          value: 'A',
        },
      ],
    });

    const returned = defaults.sourceFilter();
    if (returned) {
      (returned.filterSet[0] as { value: string }).value = 'mutated output';
    }
    expect(defaults.sourceFilter()).toEqual({
      conjunction: 'and',
      filterSet: [
        {
          fieldId: 'fldDefault',
          operator: 'IN',
          isSymbol: true,
          value: 'A',
        },
      ],
    });
  });

  it('rejects an arbitrary source filter payload', () => {
    const result = ViewQueryDefaults.create(
      {},
      {
        sourceFilter: {
          conjunction: 'and',
          filterSet: [{ arbitraryMetadata: 'must not persist' }],
        },
      }
    );

    expect(result.isErr()).toBe(true);
  });

  it('rejects source-filter operators and incomplete date values outside the public contract', () => {
    const unsupportedOperator = ViewQueryDefaults.create(
      {},
      {
        sourceFilter: {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: 'fldDate',
              operator: 'BETWEEN',
              isSymbol: true,
              value: [1, 2],
            },
          ],
        },
      }
    );
    const incompleteDateRange = ViewQueryDefaults.create(
      {},
      {
        sourceFilter: {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: 'fldDate',
              operator: 'is',
              value: {
                mode: 'dateRange',
                exactDate: '2026-01-01T00:00:00Z',
                timeZone: 'UTC',
              },
            },
          ],
        },
      }
    );
    const unexpectedArray = ViewQueryDefaults.create(
      {},
      {
        sourceFilter: {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: 'fldNumber',
              operator: 'isGreater',
              value: [1, 2],
            },
          ],
        },
      }
    );

    expect(unsupportedOperator.isErr()).toBe(true);
    expect(incompleteDateRange.isErr()).toBe(true);
    expect(unexpectedArray.isErr()).toBe(true);
  });

  it('derives date-range canonical conditions from the public source filter', () => {
    const defaults = ViewQueryDefaults.create(
      {},
      {
        sourceFilter: {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: 'fldDate',
              operator: '=',
              isSymbol: true,
              value: {
                mode: 'dateRange',
                exactDate: '2026-01-01T00:00:00Z',
                exactDateEnd: '2026-01-31T23:59:59Z',
                timeZone: 'UTC',
              },
            },
          ],
        },
      }
    )._unsafeUnwrap();

    expect(defaults.filter()).toEqual({
      conjunction: 'and',
      items: [
        {
          conjunction: 'and',
          items: [
            {
              fieldId: 'fldDate',
              operator: 'isOnOrAfter',
              value: {
                mode: 'exactDate',
                exactDate: '2026-01-01T00:00:00Z',
                timeZone: 'UTC',
              },
            },
            {
              fieldId: 'fldDate',
              operator: 'isOnOrBefore',
              value: {
                mode: 'exactDate',
                exactDate: '2026-01-31T23:59:59Z',
                timeZone: 'UTC',
              },
            },
          ],
        },
      ],
    });
  });

  it('merges sort with query taking precedence', () => {
    const defaults = ViewQueryDefaults.create({
      sort: [
        { fieldId: 'fldA', order: 'asc' },
        { fieldId: 'fldB', order: 'desc' },
      ],
    })._unsafeUnwrap();

    const merged = defaults.merge({
      sort: [
        { fieldId: 'fldB', order: 'asc' },
        { fieldId: 'fldC', order: 'desc' },
      ],
    });

    expect(merged.sort()).toEqual([
      { fieldId: 'fldB', order: 'asc' },
      { fieldId: 'fldC', order: 'desc' },
      { fieldId: 'fldA', order: 'asc' },
    ]);
  });

  it('returns empty sort when manualSort is true with no query sort', () => {
    const defaults = ViewQueryDefaults.create({
      sort: [{ fieldId: 'fldA', order: 'asc' }],
      manualSort: true,
    })._unsafeUnwrap();

    const merged = defaults.merge({});

    expect(merged.sort()).toEqual([]);
  });
});
