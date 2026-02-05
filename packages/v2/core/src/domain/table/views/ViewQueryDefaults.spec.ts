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
