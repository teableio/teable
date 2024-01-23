import type { IFilter } from '@teable-group/core';
import { FieldType } from '@teable-group/core';
import { cloneDeep } from 'lodash';
import type { IFieldInstance } from '../../model';
import { operatorLabelMapping, fieldNumberLabelMap, EMPTYOPERATORS } from './constant';
import { isFilterItem } from './types';

export const getFieldOperatorMapping = (type?: FieldType) => {
  let mergedMapping = cloneDeep(operatorLabelMapping);
  if (type === FieldType.Number) {
    mergedMapping = { ...operatorLabelMapping, ...fieldNumberLabelMap };
  }
  return mergedMapping;
};

export const getFilterFieldIds = (
  filter: NonNullable<IFilter>['filterSet'],
  fieldMap: Record<string, IFieldInstance>
): Set<string> => {
  const filterIds = new Set<string>();

  filter.forEach((item) => {
    if (isFilterItem(item)) {
      // checkbox's default value is null, but it does work
      if (
        item.value === 0 ||
        item.value ||
        EMPTYOPERATORS.includes(item.operator) ||
        fieldMap[item.fieldId]?.type === FieldType.Checkbox
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
