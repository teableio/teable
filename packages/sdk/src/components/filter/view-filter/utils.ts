import type { IFilter, IFilterItem } from '@teable/core';
import { CellValueType, FieldType } from '@teable/core';
import type { IFieldInstance } from '../../../model';
import type { IConditionItemProperty } from '../types';
import { EMPTY_OPERATORS, ARRAY_OPERATORS } from './constant';
import { isFilterItem } from './type-guard';
import type { IViewFilterConditionItem, IBaseViewFilter } from './types';

export const viewFilter2BaseFilter = <T extends IConditionItemProperty = IViewFilterConditionItem>(
  viewFilter: IFilter
): IBaseViewFilter<T> => {
  if (!viewFilter) {
    return {
      conjunction: 'and',
      children: [],
    } as IBaseViewFilter<T>;
  }

  const transform = (
    filter: NonNullable<IFilter> | IFilterItem
  ): IBaseViewFilter | IBaseViewFilter['children'][number] => {
    if ('filterSet' in filter) {
      return {
        conjunction: filter.conjunction,
        children: filter.filterSet.map(transform),
      };
    } else {
      return {
        field: filter.fieldId,
        operator: filter.operator,
        value: filter.value,
      };
    }
  };

  return transform(viewFilter) as IBaseViewFilter<T>;
};

export const baseFilter2ViewFilter = <T extends IConditionItemProperty = IViewFilterConditionItem>(
  baseFilter: IBaseViewFilter<T>
): IFilter => {
  if (baseFilter?.children?.length === 0) {
    return null;
  }

  const transform = (
    filter: IBaseViewFilter<T> | IBaseViewFilter<T>['children'][number]
  ): IFilter | IFilterItem => {
    if ('children' in filter) {
      return {
        conjunction: filter.conjunction,
        filterSet: filter.children.map(transform),
      } as IFilter;
    } else {
      return {
        fieldId: filter.field,
        operator: filter.operator,
        value: filter.value,
      } as IFilterItem;
    }
  };

  return transform(baseFilter) as IFilter;
};

/**
 * 1. when the operator type change to empty, the value should be null
 * 2. when the operator type change and the cellValueType changed, the value should be null
 */
export const shouldResetFieldValue = (newOperator: string, oldOperator: string): boolean => {
  const getOperatorType = (operator: string) => {
    if (EMPTY_OPERATORS.includes(operator)) {
      return 'empty';
    }

    if (ARRAY_OPERATORS.includes(operator)) {
      return 'multiple';
    }

    return 'common';
  };

  const newOperatorType = getOperatorType(newOperator);
  const oldOperatorType = getOperatorType(oldOperator);

  // date type exchange from `isWithIn` or to `isWithIn` should reset value
  if ((newOperator === 'isWithIn' || oldOperator === 'isWithIn') && newOperator !== oldOperator) {
    return true;
  }

  if (newOperatorType === oldOperatorType) {
    return false;
  }

  return true;
};

export const shouldFilterByDefaultValue = (
  field: { type: FieldType; cellValueType: CellValueType } | undefined
) => {
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
