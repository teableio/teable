import type { IFilter, IFilterSet, IFilterMeta } from '@teable-group/core';

import { useFields } from '@teable-group/sdk';
import AddBoldIcon from '@teable-group/ui-lib/icons/app/add-bold.svg';
import FilterIcon from '@teable-group/ui-lib/icons/app/filter.svg';
import { Button } from '@teable-group/ui-lib/shadcn/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@teable-group/ui-lib/shadcn/ui/popover';
import { cloneDeep } from 'lodash';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { Condition, ConditionGroup } from './condition';
import { FilterContext } from './context';
import type { IFilterProps } from './types';
import { isFilterMeta } from './types';

const title = 'In this view, show records';
const emptyText = 'No filter conditions are applied';

function Filter(props: IFilterProps) {
  const { onChange } = props;
  const [filters, setFilters] = useState(props.filters || {});
  useEffect(() => {
    setFilters(props.filters);
  }, [props.filters]);
  const fields = useFields();

  // calculate the filter text
  const filterText = useMemo(() => {
    const defaultText = `Filter`;
    const filterIds = new Set();
    let text = '';
    const preOrder = (filter: IFilter['filterSet']) => {
      filter.forEach((item) => {
        if (isFilterMeta(item)) {
          // todo add `not-empty` and so on
          if (item.value) {
            filterIds.add(item.fieldId);
          }
        } else {
          preOrder(item.filterSet);
        }
      });
    };
    preOrder(filters.filterSet);
    text = filterIds.size ? 'filtered by ' : '';
    [...filterIds.values()].forEach((id, index) => {
      const name = fields.find((field) => field.id === id)?.name;
      if (name) {
        text += `${index === 0 ? '' : ', '}${name}`;
      }
    });
    return text || defaultText;
  }, [filters, fields]);

  const updateFilter = useCallback(
    (val: IFilterProps['filters']) => {
      setFilters(val);
      onChange?.(filters);
      // todo sharedb servers
    },
    [filters, onChange]
  );

  // get primary field id
  const defaultFieldId = useMemo(() => {
    return fields.find((field) => field.isPrimary)?.id;
  }, [fields]);

  const addCondition = useCallback(
    (curFilter: IFilterSet) => {
      const filterItem: IFilterMeta = {
        // id: generateViewId(),
        operator: 'is',
        value: '',
        fieldId: defaultFieldId as string,
      };
      curFilter.filterSet.push(filterItem);
      const newFilters = cloneDeep(filters);
      updateFilter(newFilters);
    },
    [defaultFieldId, filters, updateFilter]
  );
  const addConditionGroup = useCallback(
    (curFilter: IFilterSet) => {
      curFilter.filterSet.push({
        // id: generateViewId(),
        // type: 'Nested',
        filterSet: [],
        conjunction: 'and',
      });
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
            className={cn('font-normal', filterText !== 'Filter' ? 'bg-[#fad2fc]' : '')}
          >
            <FilterIcon className="text-lg pr-1" />
            <span>{filterText}</span>
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

            <Button variant="ghost" onClick={() => addConditionGroup(filters)}>
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
