import type { IFilter } from '@teable/core';
import { Filter as FilterIcon } from '@teable/icons';
import { keyBy } from 'lodash';
import { useCallback, useMemo } from 'react';
import { useTranslation } from '../../../../context/app/i18n';
import type { IFieldInstance } from '../../../../model';
import { getFilterFieldIds } from '../utils';

export const useFilterNode = (filters: IFilter | null | undefined, fields: IFieldInstance[]) => {
  const { t } = useTranslation();
  const generateFilterButtonText = useCallback(
    (filterIds: Set<string>, fields: IFieldInstance[]): string => {
      let text = filterIds.size ? t('filter.displayLabel') : '';
      const defaultText = t('filter.label');
      const filterIdsArr = Array.from(filterIds);

      filterIdsArr.forEach((id, index) => {
        const name = fields.find((field) => field.id === id)?.name;
        if (name) {
          text += `${index === 0 ? '' : ', '}${name}`;
        }
      });

      if (filterIds.size > 2) {
        const name = fields.find((field) => field.id === filterIdsArr?.[0])?.name;
        text = `${t('filter.displayLabel_other', { fieldName: name, count: filterIds.size - 1 })}`;
      }

      return text || defaultText;
    },
    [t]
  );

  const text = useMemo(() => {
    let filteredIds = new Set<string>();
    if (filters) {
      filteredIds = getFilterFieldIds(filters?.filterSet, keyBy(fields, 'id'));
    }
    return generateFilterButtonText(filteredIds, fields);
  }, [fields, filters, generateFilterButtonText]);

  return {
    text,
    isActive: text !== t('filter.label'),
    Icon: FilterIcon,
  };
};
