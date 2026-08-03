import { cloneDeep } from 'lodash';
import type { FieldKeyType } from '../record/record';
import type { IFilter, IFilterItem } from './filter';
import type { IGroup } from './group';
import type { ISortItem } from './sort';

// replace all value in fieldId key with real fieldId
export function replaceFilter(
  filter: IFilter,
  fieldMap: Record<string, { id: string; name: string; dbFieldName: string }>,
  to: FieldKeyType
): IFilter {
  const traverse = (filterItem: IFilter | IFilterItem) => {
    if (filterItem && 'fieldId' in filterItem) {
      // Replace fieldId with real id from fieldMap
      filterItem.fieldId = fieldMap[filterItem.fieldId]?.[to];
    } else if (filterItem && 'filterSet' in filterItem) {
      // Recursively traverse nested filterSet
      filterItem.filterSet.forEach((item) => traverse(item));
    }
  };

  const transformedFilter = cloneDeep(filter);

  traverse(transformedFilter);

  return transformedFilter;
}

export function replaceSearch(
  search: [string] | [string, string] | [string, string, boolean],
  fieldMap: Record<string, { id: string; name: string; dbFieldName: string }>,
  to: FieldKeyType
): [string] | [string, string] | [string, string, boolean] {
  const [searchValue, fieldKeys, hideNotMatchRow] = search;

  if (!fieldKeys) {
    return search;
  }

  const fieldIds = fieldKeys
    .split(',')
    .map((key) => fieldMap[key.trim()]?.[to])
    .join(',');

  return hideNotMatchRow ? [searchValue, fieldIds, hideNotMatchRow] : [searchValue, fieldIds];
}

export function replaceGroupBy(
  groupBy: IGroup,
  fieldMap: Record<string, { id: string; name: string; dbFieldName: string }>,
  to: FieldKeyType
): IGroup {
  if (!groupBy) {
    return groupBy;
  }

  return groupBy.map((item) => ({
    ...item,
    fieldId: fieldMap[item.fieldId]?.[to],
  }));
}

export function replaceOrderBy(
  orderBy: ISortItem[],
  fieldMap: Record<string, { id: string; name: string; dbFieldName: string }>,
  to: FieldKeyType
): ISortItem[] {
  return orderBy.map((item) => ({
    ...item,
    fieldId: fieldMap[item.fieldId]?.[to],
  }));
}
