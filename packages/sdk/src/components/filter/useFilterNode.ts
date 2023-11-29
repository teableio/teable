import { Filter as FilterIcon } from '@teable-group/icons';
import { useCallback, useMemo } from 'react';
import { useFields } from '../../hooks';
import type { IFieldInstance } from '../../model';
import { EMPTYOPERATORS } from './constant';
import type { IFilter } from './types';
import { isFilterItem } from './types';

export const useFilterNode = (filters?: IFilter | null) => {
  const fields = useFields({ withHidden: true });

  const isCheckBox = useCallback(
    (fieldId: string) => {
      return fields.find((field) => field.id === fieldId)?.type === 'checkbox';
    },
    [fields]
  );

  const preOrder = useCallback(
    (filter: IFilter['filterSet']): Set<string> => {
      const filterIds = new Set<string>();

      filter.forEach((item) => {
        if (isFilterItem(item)) {
          // checkbox's default value is null, but it does work
          if (
            item.value === 0 ||
            item.value ||
            EMPTYOPERATORS.includes(item.operator) ||
            isCheckBox(item.fieldId)
          ) {
            filterIds.add(item.fieldId);
          }
        } else {
          const childFilterIds = preOrder(item.filterSet);
          childFilterIds.forEach((id) => filterIds.add(id));
        }
      });

      return filterIds;
    },
    [isCheckBox]
  );

  const generateFilterButtonText = (filterIds: Set<string>, fields: IFieldInstance[]): string => {
    let text = filterIds.size ? 'Filtered by ' : '';
    const defaultText = 'Filter';
    const filterIdsArr = Array.from(filterIds);

    filterIdsArr.forEach((id, index) => {
      const name = fields.find((field) => field.id === id)?.name;
      if (name) {
        text += `${index === 0 ? '' : ', '}${name}`;
      }
    });

    if (filterIds.size > 2) {
      const name = fields.find((field) => field.id === filterIdsArr?.[0])?.name;
      text = `Filtered by ${name} and ${filterIds.size - 1} other field`;
    }

    return text || defaultText;
  };

  const text = useMemo(() => {
    let filteredIds = new Set<string>();
    if (filters) {
      filteredIds = preOrder(filters?.filterSet);
    }
    return generateFilterButtonText(filteredIds, fields);
  }, [fields, filters, preOrder]);

  return {
    text,
    isActive: text !== 'Filter',
    Icon: FilterIcon,
  };
};
