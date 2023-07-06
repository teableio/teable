import type { IFilterGroupItem } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isFilterGroupItem(item: any): item is IFilterGroupItem {
  return !!item?.type;
}

export { isFilterGroupItem };
