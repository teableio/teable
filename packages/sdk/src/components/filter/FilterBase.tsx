import type { IFilter, IFilterItem, IConjunction } from '@teable-group/core';
import { getValidFilterOperators } from '@teable-group/core';

import { Plus, Share2 } from '@teable-group/icons';

import { Button, Popover, PopoverContent, PopoverTrigger } from '@teable-group/ui-lib';

import { produce } from 'immer';
import { cloneDeep, isEqual, set, get } from 'lodash';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDebounce } from 'react-use';

import { useTranslation } from '../../context/app/i18n';
import { Condition, ConditionGroup } from './condition';
import { FilterContext } from './context';
import type { IFilterBaseProps, IFiltersPath } from './types';
import { isFilterItem, ConditionAddType } from './types';

const title = 'In this view, show records';
const emptyText = 'No filter conditions are applied';
const defaultFilter: NonNullable<IFilter> = {
  conjunction: 'and',
  filterSet: [],
};
const defaultGroupFilter: NonNullable<IFilter> = {
  ...defaultFilter,
  conjunction: 'or',
};

function FilterBase(props: IFilterBaseProps) {
  const { onChange, filters: initFilter, fields, children } = props;
  const { t } = useTranslation();
  const [filters, setFilters] = useState<IFilter | null>(initFilter);

  const setFilterHandler = (
    path: IFiltersPath,
    value: IFilterItem['value'] | IConjunction | IFilterItem['fieldId'] | IFilterItem['operator']
  ) => {
    if (filters) {
      const newFilters = produce(filters, (draft) => {
        set(draft, path, value);
      });
      setFilters(newFilters);
    }
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
    const defaultOpertor = defaultField && getValidFilterOperators(defaultField);
    return {
      operator: defaultOpertor?.[0],
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

  const conditionCreator = () => {
    if (!filters?.filterSet?.length) {
      return null;
    }
    const initLevel = 0;

    return (
      <div className="max-h-96 overflow-auto ">
        {filters?.filterSet?.map((filterItem, index) =>
          isFilterItem(filterItem) ? (
            <Condition
              key={index}
              filter={filterItem}
              index={index}
              conjunction={filters.conjunction}
              level={initLevel}
              path={['filterSet', index]}
            />
          ) : (
            <ConditionGroup
              key={index}
              filter={filterItem}
              index={index}
              conjunction={filters.conjunction}
              level={initLevel}
              path={['filterSet', index]}
            />
          )
        )}
      </div>
    );
  };

  return (
    <FilterContext.Provider
      value={{
        setFilters: setFilterHandler,
        onChange: onChange,
        addCondition: addCondition,
        deleteCondition: deleteCondition,
      }}
    >
      <Popover>
        <PopoverTrigger asChild>{children}</PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="start"
          className="w-min min-w-[544px] max-w-screen-md p-0"
        >
          <div className="flex max-w-full items-center justify-start rounded-t bg-accent px-4 py-2 text-[11px]">
            <Share2 className="mr-4 h-4 w-4 shrink-0" />
            <span className="text-muted-foreground">{t('filter.description')}</span>
          </div>
          <div className="text-[13px]">
            {filters?.filterSet?.length ? (
              <div className="px-4 pt-3">{title}</div>
            ) : (
              <div className="px-4 pt-4 text-muted-foreground">{emptyText}</div>
            )}
          </div>
          <div className="px-4 pt-3">{conditionCreator()}</div>
          <div className="flex w-max p-3">
            <Button
              variant="ghost"
              size="xs"
              className="text-[13px]"
              onClick={() => addCondition([], ConditionAddType.ITEM)}
            >
              <Plus className="h-4 w-4" />
              {t('filter.addCondition')}
            </Button>

            <Button
              variant="ghost"
              size="xs"
              onClick={() => addCondition([], ConditionAddType.GROUP)}
              className="text-[13px]"
            >
              <Plus className="h-4 w-4" />
              {t('filter.addConditionGroup')}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </FilterContext.Provider>
  );
}

export { FilterBase };
