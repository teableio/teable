import { Me, type IFilter } from '@teable/core';

export function filterHasMe(filter: IFilter | undefined) {
  if (!filter) {
    return false;
  }
  return JSON.stringify(filter).includes(Me);
}
