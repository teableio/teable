import { extractFieldIdsFromFilter, type IFilter } from '../models/view/filter/filter';
import type { IGroupItem } from '../models/view/group/group';
import type { ISortItem } from '../models/view/sort/sort';
import { IdPrefix } from './id-generator';

// [search string, comma-separated field ids or names, hideNotMatchRow]
type ISearchQuery = [string] | [string, string] | [string, string, boolean];

type ILinkCellFilter = string | [string, string];

export interface ICollectQueryFieldIdsOptions {
  filter?: IFilter;
  search?: ISearchQuery;
  orderBy?: ReadonlyArray<ISortItem>;
  groupBy?: ReadonlyArray<IGroupItem> | null;
  filterLinkCellCandidate?: ILinkCellFilter;
  filterLinkCellSelected?: ILinkCellFilter;
  extraFieldIds?: string[];
}

/**
 * Collect all field IDs referenced by a query's filter/search/sort/group/link params.
 * Returns null when the scope is unbounded (e.g. global search without a target field),
 * meaning any field change could be relevant.
 */
// eslint-disable-next-line sonarjs/cognitive-complexity
export const collectQueryFieldIds = (options: ICollectQueryFieldIdsOptions): Set<string> | null => {
  const ids = new Set<string>();

  // search only affects query membership when hideNotMatchRow (search[2]) is set
  if (options.search?.[0] && options.search[2]) {
    // global search: any field change could be relevant
    if (!options.search[1]) return null;
    for (const token of options.search[1].split(',')) {
      // search accepts field names too; those cannot be resolved here
      if (!token.startsWith(IdPrefix.Field)) return null;
      ids.add(token);
    }
  }

  for (const fid of extractFieldIdsFromFilter(options.filter, true)) {
    ids.add(fid);
  }

  if (options.orderBy) {
    for (const item of options.orderBy) {
      ids.add(item.fieldId);
    }
  }

  if (options.groupBy) {
    for (const item of options.groupBy) {
      ids.add(item.fieldId);
    }
  }

  if (options.filterLinkCellCandidate) {
    const v = options.filterLinkCellCandidate;
    ids.add(Array.isArray(v) ? v[0] : v);
  }
  if (options.filterLinkCellSelected) {
    const v = options.filterLinkCellSelected;
    ids.add(Array.isArray(v) ? v[0] : v);
  }

  if (options.extraFieldIds) {
    for (const fid of options.extraFieldIds) {
      ids.add(fid);
    }
  }

  return ids;
};
