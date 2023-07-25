import type { IFilterMeta, IFilterSet } from '@teable-group/core';

function isFilterMeta(item: unknown): item is IFilterMeta {
  return !Array.isArray((item as IFilterSet)?.filterSet);
}

export { isFilterMeta };
