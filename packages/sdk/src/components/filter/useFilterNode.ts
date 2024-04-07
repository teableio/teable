import { Filter as FilterIcon } from '@teable/icons';
import { keyBy } from 'lodash';
import { useMemo } from 'react';
import type { IFieldInstance } from '../../model';
import type { IFilter } from './types';
import { getFilterFieldIds } from './utils';

export const useFilterNode = (filters: IFilter | null | undefined, fields: IFieldInstance[]) => {
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
      filteredIds = getFilterFieldIds(filters?.filterSet, keyBy(fields, 'id'));
    }
    return generateFilterButtonText(filteredIds, fields);
  }, [fields, filters]);

  return {
    text,
    isActive: text !== 'Filter',
    Icon: FilterIcon,
  };
};
