import { describe, expect, it } from 'vitest';
import type { IFilter } from '../models/view/filter/filter';
import { SortFunc } from '../models/view/sort/sort-func.enum';
import { collectQueryFieldIds } from './query-field-ids';

const filter: IFilter = {
  conjunction: 'and',
  filterSet: [
    { fieldId: 'fldA', operator: 'is', value: '1' },
    {
      conjunction: 'or',
      filterSet: [{ fieldId: 'fldB', operator: 'isNot', value: '2' }],
    },
  ],
} as IFilter;

describe('collectQueryFieldIds', () => {
  it('collects nested filter, orderBy and groupBy field ids', () => {
    const ids = collectQueryFieldIds({
      filter,
      orderBy: [{ fieldId: 'fldSort', order: SortFunc.Asc }],
      groupBy: [{ fieldId: 'fldGroup', order: SortFunc.Asc }],
    });
    expect(ids).toEqual(new Set(['fldA', 'fldB', 'fldSort', 'fldGroup']));
  });

  it('ignores a display-only search (hideNotMatchRow off)', () => {
    const ids = collectQueryFieldIds({ search: ['hello', 'fldA', false] });
    expect(ids).toEqual(new Set());
  });

  it('returns null for a global filtering search', () => {
    expect(collectQueryFieldIds({ search: ['hello', '', true] })).toBeNull();
  });

  it('collects comma-separated field ids of a scoped filtering search', () => {
    const ids = collectQueryFieldIds({ search: ['hello', 'fldA,fldB', true] });
    expect(ids).toEqual(new Set(['fldA', 'fldB']));
  });

  it('returns null when a filtering search is scoped by field name', () => {
    expect(collectQueryFieldIds({ search: ['hello', 'My Field', true] })).toBeNull();
  });

  it('collects link cell filters and extra field ids', () => {
    const ids = collectQueryFieldIds({
      filterLinkCellCandidate: 'fldLinkA',
      filterLinkCellSelected: ['fldLinkB', 'recX'],
      extraFieldIds: ['fldExtra'],
    });
    expect(ids).toEqual(new Set(['fldLinkA', 'fldLinkB', 'fldExtra']));
  });
});
