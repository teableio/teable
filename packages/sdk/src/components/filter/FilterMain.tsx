import type { IFilter, IFilterItem, IConjunction } from '@teable/core';
import { getValidFilterOperators } from '@teable/core';

import { Plus } from '@teable/icons';

import { Button } from '@teable/ui-lib';

import { produce } from 'immer';
import { cloneDeep, isEqual, set, get } from 'lodash';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDebounce } from 'react-use';

import { useTranslation } from '../../context/app/i18n';
import { Condition, ConditionGroup } from './condition';
import { FilterContext } from './context';
import type { IFilterBaseProps, IFiltersPath } from './types';
import { isFilterItem, ConditionAddType } from './types';

const defaultFilter: NonNullable<IFilter> = {
  conjunction: 'and',
  filterSet: [],
};
const defaultGroupFilter: NonNullable<IFilter> = {
  ...defaultFilter,
  conjunction: 'or',
};

export interface IFilterMainProps
  extends Pick<IFilterBaseProps, 'filters' | 'fields' | 'components' | 'context' | 'onChange'> {
  customFieldValue?: (
    filter: IFilterItem,
    onSelect: (value: IFilterItem['value']) => void
  ) => JSX.Element;
}

export const FilterMain = (props: IFilterMainProps) => {
  const { filters: initFilter, fields, components, context, onChange, customFieldValue } = props;

  const { t } = useTranslation();
  const [filters, setFilters] = useState<IFilter | null>(initFilter);

  const setFilterHandler = (
    path: IFiltersPath,
    value: IFilterItem['value'] | IConjunction | IFilterItem['fieldId'] | IFilterItem['operator']
  ) => {
    setFilters((prev) => {
      if (prev) {
        return produce(prev, (draft) => {
          set(draft, path, value);
        });
      }
      return prev;
    });
  };

  useEffect(() => {
    const newFilter = cloneDeep(initFilter);
    setFilters(newFilter);
  }, [initFilter]);

  useDebounce(
    () => {
      if (!isEqual(filters, initFilter)) {
        onChange?.(filters);
      }
    },
    500,
    [filters]
  );

  // use the primary to be default metadata
  const defaultIFilterItem = useMemo<IFilterItem>(() => {
    const defaultField = fields.find((field) => field.isPrimary);
    const defaultOperator = defaultField && getValidFilterOperators(defaultField);
    return {
      operator: defaultOperator?.[0],
      value: null,
      fieldId: defaultField?.id,
    } as IFilterItem;
  }, [fields]);

  const addCondition = useCallback(
    (path: IFiltersPath, type = ConditionAddType.ITEM) => {
      const conditionItem =
        type === ConditionAddType.ITEM ? { ...defaultIFilterItem } : { ...defaultGroupFilter };

      let newFilters = null;

      /**
       * first add from null, set the default
       */
      if (!filters) {
        newFilters = cloneDeep(defaultFilter);
        newFilters.filterSet.push(conditionItem);
        setFilters(newFilters);
        return;
      }

      newFilters = produce(filters, (draft) => {
        const target = path.length ? get(draft, path) : draft;
        target.filterSet.push(conditionItem);
      });

      setFilters(newFilters);
    },
    [defaultIFilterItem, filters]
  );

  /**
   * different from other way to update filters, delete need to back to parent path
   * because current filter item only can delete from it's parent
   * @param path Filter Object Path
   * @param index the index of filterSet which need to delete
   * @returns void
   */
  const deleteCondition = (path: IFiltersPath, index: number) => {
    let newFilters = null;
    // get the parent path
    const parentPath = path.slice(0, -2);

    newFilters = produce(filters, (draft) => {
      const target = parentPath?.length ? get(draft, parentPath) : draft;
      target.filterSet.splice(index, 1);
    });

    // delete all filter, should return null
    if (!newFilters?.filterSet.length) {
      setFilters(null);
      return;
    }

    setFilters(newFilters);
  };

  const conditionCreator = useMemo(() => {
    if (!filters?.filterSet?.length) {
      return null;
    }
    const initLevel = 0;

    return (
      <div className="max-h-96 overflow-auto">
        {filters?.filterSet?.map((filterItem, index) =>
          isFilterItem(filterItem) ? (
            <Condition
              key={index}
              filter={filterItem}
              index={index}
              conjunction={filters.conjunction}
              level={initLevel}
              path={['filterSet', index]}
              customFieldValue={customFieldValue}
            />
          ) : (
            <ConditionGroup
              key={index}
              filter={filterItem}
              index={index}
              conjunction={filters.conjunction}
              level={initLevel}
              path={['filterSet', index]}
              customFieldValue={customFieldValue}
            />
          )
        )}
      </div>
    );
  }, [filters?.conjunction, filters?.filterSet, customFieldValue]);

  return (
    <FilterContext.Provider
      value={{
        fields,
        context,
        components,
        setFilters: setFilterHandler,
        onChange: onChange,
        addCondition: addCondition,
        deleteCondition: deleteCondition,
      }}
    >
      {conditionCreator && <div className="px-4 pt-3">{conditionCreator}</div>}
      <div className="flex w-max p-3">
        <Button
          variant="ghost"
          size="xs"
          className="text-[13px]"
          onClick={() => addCondition([], ConditionAddType.ITEM)}
        >
          <Plus className="size-4" />
          {t('filter.addCondition')}
        </Button>

        <Button
          variant="ghost"
          size="xs"
          onClick={() => addCondition([], ConditionAddType.GROUP)}
          className="text-[13px]"
        >
          <Plus className="size-4" />
          {t('filter.addConditionGroup')}
        </Button>
      </div>
    </FilterContext.Provider>
  );
};
