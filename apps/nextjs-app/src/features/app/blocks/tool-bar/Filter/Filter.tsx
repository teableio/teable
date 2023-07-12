import type { IFilter, IFilterSet, IFilterMeta } from '@teable-group/core';
import type { IFieldInstance } from '@teable-group/sdk';

import { useFields } from '@teable-group/sdk';
import AddBoldIcon from '@teable-group/ui-lib/icons/app/add-bold.svg';
import FilterIcon from '@teable-group/ui-lib/icons/app/filter.svg';
import { Button } from '@teable-group/ui-lib/shadcn/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@teable-group/ui-lib/shadcn/ui/popover';
import { cloneDeep } from 'lodash';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { Condition, ConditionGroup } from './condition';
import { EMPTYOPERATORS } from './constant';
import { FilterContext } from './context';
import type { IFilterProps } from './types';
import { isFilterMeta } from './types';

const title = 'In this view, show records';
const emptyText = 'No filter conditions are applied';

function Filter(props: IFilterProps) {
  const { onChange, filters: initFilter } = props;
  const [filters, setFilters] = useState(initFilter || {});
  const fields = useFields({ widthHidden: true });

  useEffect(() => {
    setFilters(initFilter);
  }, [initFilter]);

  const defaultFieldId = useMemo(() => {
    return fields.find((field) => field.isPrimary)?.id;
  }, [fields]);

  const preOrder = useCallback((filter: IFilter['filterSet']): Set<string> => {
    const filterIds = new Set<string>();

    filter.forEach((item) => {
      if (isFilterMeta(item)) {
        if (item.value || EMPTYOPERATORS.includes(item.operator)) {
          filterIds.add(item.fieldId);
        }
      } else {
        const childFilterIds = preOrder(item.filterSet);
        childFilterIds.forEach((id) => filterIds.add(id));
      }
    });

    return filterIds;
  }, []);

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

  const filterButtonText = useMemo(() => {
    const filteredIds = preOrder(filters.filterSet);
    return generateFilterButtonText(filteredIds, fields);
  }, [fields, filters.filterSet, preOrder]);

  const updateFilter = useCallback(
    (val: IFilterProps['filters']) => {
      setFilters(val);
      onChange?.(filters);
    },
    [filters, onChange]
  );

  const addCondition = useCallback(
    (curFilter: IFilterSet) => {
      const defaultIFilterMeta: IFilterMeta = {
        operator: 'is',
        value: null,
        fieldId: defaultFieldId as string,
      };
      const filterItem: IFilterMeta = defaultIFilterMeta;
      curFilter.filterSet.push(filterItem);
      const newFilters = cloneDeep(filters);
      updateFilter(newFilters);
    },
    [defaultFieldId, filters, updateFilter]
  );
  const addConditionGroup = useCallback(
    (curFilter: IFilterSet) => {
      const defaultIFilteSet: IFilterSet = {
        filterSet: [],
        conjunction: 'and',
      };
      curFilter.filterSet.push(defaultIFilteSet);
      const newFilters = cloneDeep(filters);
      updateFilter(newFilters);
    },
    [filters, updateFilter]
  );

  const conditionCreator = () => {
    if (!filters?.filterSet?.length) {
      return null;
    }
    const initLevel = 0;

    return (
      <div className="max-h-96 overflow-auto">
        {filters?.filterSet?.map((filterItem, index) =>
          isFilterMeta(filterItem) ? (
            <Condition key={index} filter={filterItem} index={index} parent={filters} />
          ) : (
            <ConditionGroup
              key={index}
              filter={filterItem}
              index={index}
              parent={filters}
              level={initLevel}
            />
          )
        )}
      </div>
    );
  };

  return (
    <FilterContext.Provider
      value={{
        filters: filters,
        setFilters: updateFilter,
        onChange: onChange,
        addCondition: addCondition,
        addConditionGroup: addConditionGroup,
      }}
    >
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant={'ghost'}
            size={'xs'}
            className={cn(
              'font-normal max-w-sm truncate',
              filterButtonText !== 'Filter' ? 'bg-secondary' : ''
            )}
          >
            <FilterIcon className="text-lg pr-1 shrink" />
            <span className="truncate">{filterButtonText}</span>
          </Button>
        </PopoverTrigger>

        <PopoverContent side="bottom" align="start" className="w-max">
          <div className="text-gray-400 text-xs">
            {filters?.filterSet?.length ? title : emptyText}
          </div>
          <div>{conditionCreator()}</div>
          <div className="flex p-1 w-max">
            <Button variant="ghost" onClick={() => addCondition(filters)}>
              <AddBoldIcon className="h-4 w-4" />
              Add condition
            </Button>

            <Button
              variant="ghost"
              onClick={() => addConditionGroup(filters)}
              className="dark:bg-white"
            >
              <AddBoldIcon className="h-4 w-4" />
              Add condition group
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </FilterContext.Provider>
  );
}

export { Filter };
