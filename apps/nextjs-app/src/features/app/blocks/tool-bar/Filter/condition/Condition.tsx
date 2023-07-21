import type { IFilterMeta } from '@teable-group/core';

import AshBin from '@teable-group/ui-lib/icons/app/ashbin.svg';
import { Button } from '@teable-group/ui-lib/shadcn/ui/button';

import { cloneDeep, isEqual } from 'lodash';
import { useCallback, useContext } from 'react';

import { FilterContext } from '../context';
import type { IConditionProps } from '../types';
import { Conjunction } from './Conjunction';
import { FieldSelect } from './FieldSelect';
import { FieldValue } from './FieldValue';
import { OperatorSelect } from './OperatorSelect';

function Condition(props: IConditionProps) {
  const { index, filter, parent, level } = props;
  const context = useContext(FilterContext);
  const { setFilters, filters } = context;

  const deleteCurrentFilter = () => {
    parent.filterSet.splice(index, 1);
    const newFilters = cloneDeep(filters);
    if (level === 0 && !parent.filterSet.length) {
      setFilters(null);
    } else {
      setFilters(newFilters);
    }
  };

  const fieldTypeHandler = useCallback(
    (fieldId: string | null) => {
      filter.fieldId = fieldId as string;
      const newFilters = cloneDeep(filters);
      setFilters(newFilters);
    },
    [filter, filters, setFilters]
  );
  const operatorHandler = useCallback(
    (value: string) => {
      if (filter.operator !== value) {
        filter.operator = value as IFilterMeta['operator'];
        const newFilters = cloneDeep(filters);
        setFilters(newFilters);
      }
    },
    [filter, filters, setFilters]
  );
  const fieldValueHandler = useCallback(
    (value: IFilterMeta['value']) => {
      if (!isEqual(filter.value, value)) {
        filter.value = value ?? null;
        if (Array.isArray(value) && !value.length) {
          filter.value = null;
        }
        const newFilters = cloneDeep(filters);
        setFilters(newFilters);
      }
    },
    [filter, filters, setFilters]
  );

  return (
    <div className="flex items-center p-1">
      <Conjunction
        index={index}
        parent={parent}
        filters={filters}
        setFilter={setFilters}
      ></Conjunction>

      <section className="flex items-center">
        <FieldSelect fieldId={filter.fieldId} onSelect={fieldTypeHandler} />

        <OperatorSelect
          value={filter.operator}
          onSelect={operatorHandler}
          fieldId={filter.fieldId}
        />

        <FieldValue filter={filter} onSelect={fieldValueHandler}></FieldValue>

        <Button variant="outline" onClick={deleteCurrentFilter} className="dark:bg-white">
          <AshBin className="h-4 w-4"></AshBin>
        </Button>
      </section>
    </div>
  );
}

export { Condition };
