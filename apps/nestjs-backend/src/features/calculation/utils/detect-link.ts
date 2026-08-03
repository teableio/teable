import { IdPrefix } from '@teable/core';

// for performance, we detect if record contains link by check recordId cellValue
export function isLinkCellValue(value: unknown): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function isLinkCellItem(item: any): boolean {
    if (typeof item !== 'object' || item == null) {
      return false;
    }

    if ('id' in item && typeof item.id === 'string') {
      const recordId: string = item.id;
      return recordId.startsWith(IdPrefix.Record);
    }
    return false;
  }

  if (Array.isArray(value) && isLinkCellItem(value[0])) {
    return true;
  }
  return isLinkCellItem(value);
}
