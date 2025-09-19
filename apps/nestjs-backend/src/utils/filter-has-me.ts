import { Me, type IFilter } from '@teable/core';

export function filterHasMe(filter: IFilter | string | undefined | null) {
  if (!filter) {
    return false;
  }
  if (typeof filter === 'string') {
    return filter.includes(Me);
  }
  return JSON.stringify(filter).includes(Me);
}
