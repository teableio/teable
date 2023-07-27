import type { IFilterItem, IFilterSet } from '@teable-group/core';

function isFilterItem(item: unknown): item is IFilterItem {
  return !Array.isArray((item as IFilterSet)?.filterSet);
}

export { isFilterItem };
