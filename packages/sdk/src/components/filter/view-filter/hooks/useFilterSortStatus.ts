import type { IFilter, IFilterItem, IFilterSet, ISort, ISortItem } from '@teable/core';
import { isFilterItem } from '../type-guard';
import { useCallback, useMemo } from 'react';
import { useTranslation } from '../../../../context/app/i18n';
import type { IFieldInstance } from '../../../../model';
import { useOperatorI18nMap } from './useOperatorI18nMap';

export interface IFilterLabel {
  id: string;
  type: 'filter';
  fieldId: string;
  fieldName: string;
  operator: string;
  operatorLabel: string;
  value: unknown;
  valueLabel: string;
  path: (string | number)[];
}

export interface ISortLabel {
  id: string;
  type: 'sort';
  fieldId: string;
  fieldName: string;
  order: 'asc' | 'desc';
  orderLabel: string;
  index: number;
}

export interface IFilterSortStatus {
  filterLabels: IFilterLabel[];
  sortLabels: ISortLabel[];
  hasActiveFilters: boolean;
  hasActiveSorts: boolean;
  hasActiveConditions: boolean;
  removeFilterItem: (path: (string | number)[]) => IFilter | null;
  removeSortItem: (index: number) => ISort | null;
  clearAllFilters: () => null;
  clearAllSorts: () => null;
  clearAll: () => { filter: null; sort: null };
}

function flattenFilterSet(
  filterSet: (IFilterItem | IFilterSet)[],
  parentPath: (string | number)[] = []
): { item: IFilterItem; path: (string | number)[] }[] {
  const result: { item: IFilterItem; path: (string | number)[] }[] = [];

  filterSet.forEach((item, index) => {
    const currentPath = [...parentPath, index];
    if (isFilterItem(item)) {
      result.push({ item, path: currentPath });
    } else if ('filterSet' in item) {
      const nested = flattenFilterSet(item.filterSet, [...currentPath, 'filterSet']);
      result.push(...nested);
    }
  });

  return result;
}

function formatFilterValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return '';
    return value.map((v) => String(v ?? '')).join(', ');
  }

  if (typeof value === 'object') {
    if ('mode' in value) {
      const modeValue = value as { mode: string; numberOfDays?: number; exactDate?: string; exactDateEnd?: string };
      let result = modeValue.mode;
      if (modeValue.numberOfDays != null) {
        result += ` (${modeValue.numberOfDays} 天)`;
      }
      if (modeValue.exactDate) {
        result += ` ${modeValue.exactDate}`;
        if (modeValue.exactDateEnd) {
          result += ` - ${modeValue.exactDateEnd}`;
        }
      }
      return result;
    }
    return JSON.stringify(value);
  }

  return String(value);
}

export const useFilterSortStatus = (
  filter: IFilter | null | undefined,
  sort: ISort | null | undefined,
  fields: IFieldInstance[]
) => {
  const { t } = useTranslation();
  const operatorI18nMap = useOperatorI18nMap();

  const fieldMap = useMemo(() => {
    const map: Record<string, IFieldInstance> = {};
    fields.forEach((field) => {
      map[field.id] = field;
    });
    return map;
  }, [fields]);

  const filterLabels = useMemo<IFilterLabel[]>(() => {
    if (!filter || !filter.filterSet || filter.filterSet.length === 0) {
      return [];
    }

    const flatItems = flattenFilterSet(filter.filterSet, ['filterSet']);

    return flatItems.map(({ item, path }, index) => {
      const field = fieldMap[item.fieldId];
      const fieldName = field?.name ?? item.fieldId;
      const operatorLabel = operatorI18nMap[item.operator as keyof typeof operatorI18nMap] ?? item.operator;
      const valueLabel = formatFilterValue(item.value);

      return {
        id: `filter-${index}-${item.fieldId}`,
        type: 'filter' as const,
        fieldId: item.fieldId,
        fieldName,
        operator: item.operator,
        operatorLabel,
        value: item.value,
        valueLabel,
        path,
      };
    });
  }, [filter, fieldMap, operatorI18nMap]);

  const sortLabels = useMemo<ISortLabel[]>(() => {
    if (!sort || !sort.sortObjs || sort.sortObjs.length === 0) {
      return [];
    }

    return sort.sortObjs.map((sortItem, index) => {
      const field = fieldMap[sortItem.fieldId];
      const fieldName = field?.name ?? sortItem.fieldId;
      const orderLabel = sortItem.order === 'asc' ? t('sort.asc') : t('sort.desc');

      return {
        id: `sort-${index}-${sortItem.fieldId}`,
        type: 'sort' as const,
        fieldId: sortItem.fieldId,
        fieldName,
        order: sortItem.order as 'asc' | 'desc',
        orderLabel,
        index,
      };
    });
  }, [sort, fieldMap, t]);

  const removeFilterItem = useCallback(
    (path: (string | number)[]): IFilter | null => {
      if (!filter || path.length === 0) return filter;

      const deepClone = <T>(obj: T): T => JSON.parse(JSON.stringify(obj));
      const newFilter = deepClone(filter);

      let current: unknown = newFilter;
      let parent: unknown = null;
      let parentKey: string | number | null = null;

      for (let i = 0; i < path.length - 1; i++) {
        const key = path[i];
        parent = current;
        parentKey = key;

        if (typeof key === 'string') {
          current = (current as Record<string, unknown>)[key];
        } else {
          current = (current as unknown[])[key];
        }

        if (current == null) {
          return filter;
        }
      }

      const lastKey = path[path.length - 1];
      if (Array.isArray(current)) {
        const index = Number(lastKey);
        if (index >= 0 && index < current.length) {
          current.splice(index, 1);
        }
      }

      const hasItems = (f: IFilter | IFilterItem | IFilterSet): boolean => {
        if ('filterSet' in f) {
          return f.filterSet.some((item) => hasItems(item));
        }
        return true;
      };

      if (!hasItems(newFilter)) {
        return null;
      }

      return newFilter;
    },
    [filter]
  );

  const removeSortItem = useCallback(
    (index: number): ISort | null => {
      if (!sort || !sort.sortObjs) return null;

      const newSortObjs = sort.sortObjs.filter((_, i) => i !== index);

      if (newSortObjs.length === 0) {
        return null;
      }

      return {
        ...sort,
        sortObjs: newSortObjs,
      };
    },
    [sort]
  );

  const clearAllFilters = useCallback((): null => {
    return null;
  }, []);

  const clearAllSorts = useCallback((): null => {
    return null;
  }, []);

  const clearAll = useCallback((): { filter: null; sort: null } => {
    return { filter: null, sort: null };
  }, []);

  return {
    filterLabels,
    sortLabels,
    hasActiveFilters: filterLabels.length > 0,
    hasActiveSorts: sortLabels.length > 0,
    hasActiveConditions: filterLabels.length > 0 || sortLabels.length > 0,
    removeFilterItem,
    removeSortItem,
    clearAllFilters,
    clearAllSorts,
    clearAll,
  };
};
