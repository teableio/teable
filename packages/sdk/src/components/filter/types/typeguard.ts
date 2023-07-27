import type { IFilterItem, IFilterSet } from '@teable-group/core';

function isFilterMeta(item: unknown): item is IFilterItem {
  return !Array.isArray((item as IFilterSet)?.filterSet);
}

export { isFilterMeta };
