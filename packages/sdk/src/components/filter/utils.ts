import type { IFilter, IFilterItem, IFilterSet } from '@teable/core';
import { CellValueType, FieldType } from '@teable/core';
import type { IFieldInstance } from '../../model';
import { EMPTY_OPERATORS } from './constant';
import { isFilterItem } from './types';

export const shouldFilterByDefaultValue = (field: IFieldInstance | undefined) => {
  if (!field) return false;

  const { type, cellValueType } = field;
  return (
    type === FieldType.Checkbox ||
    (type === FieldType.Formula && cellValueType === CellValueType.Boolean)
  );
};

export const getFilterFieldIds = (
  filter: NonNullable<IFilter>['filterSet'],
  fieldMap: Record<string, IFieldInstance>
): Set<string> => {
  const filterIds = new Set<string>();

  filter.forEach((item) => {
    if (isFilterItem(item)) {
      // The checkbox field and the formula field, when the cellValueType is Boolean, have a default value of null, but they can still work
      const field = fieldMap[item.fieldId];
      if (
        item.value === 0 ||
        item.value ||
        EMPTY_OPERATORS.includes(item.operator) ||
        shouldFilterByDefaultValue(field)
      ) {
        filterIds.add(item.fieldId);
      }
    } else {
      const childFilterIds = getFilterFieldIds(item.filterSet, fieldMap);
      childFilterIds.forEach((id) => filterIds.add(id));
    }
  });

  return filterIds;
};

export function extractDefaultFieldsFromFilters(filters: IFilterSet | null | undefined): {
  [fieldId: string]: unknown;
} {
  const result: { [fieldId: string]: unknown } = {};
  const repeatedFieldIds = new Set<string>();

  function handleFilterItem(filter: IFilterItem | null | undefined) {
    if (filter?.operator === 'is' && filter.fieldId) {
      if (filter.fieldId in result) {
        // mark as repeat and delete
        delete result[filter.fieldId];
        repeatedFieldIds.add(filter.fieldId);
      } else if (!repeatedFieldIds.has(filter.fieldId)) result[filter.fieldId] = filter.value;
    }
  }

  // recursively traverse the filters object
  function traverse(filter: IFilterSet | IFilterItem | null | undefined) {
    if (filter && 'filterSet' in filter) filter.filterSet.forEach(traverse);
    else if (filter) handleFilterItem(filter);
  }

  traverse(filters);

  return result;
}
