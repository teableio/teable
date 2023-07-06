import type { FOperator } from '@teable-group/core';
import AshBin from '@teable-group/ui-lib/icons/app/ashbin.svg';
import { Button } from '@teable-group/ui-lib/shadcn/ui/button';
import { cloneDeep } from 'lodash';
import { useContext } from 'react';
import { FilterContext } from '../context';
import type { IConditionProps } from '../types/types';

import { Conjunction } from './Conjunction';
import { FieldSelect } from './FieldSelect';
import { FieldValue } from './FieldValue';
import { OperatorSelect } from './OperatorSelect';

function Condition(props: IConditionProps) {
  const { index, filter, parent } = props;
  const context = useContext(FilterContext);
  if (!context) {
    return null;
  }
  const { setFilters, filters } = context;

  const deleteItem = () => {
    parent.filterSet.splice(index, 1);
    const newFilters = cloneDeep(filters);
    setFilters(newFilters);
  };

  const selectField = (columnId: string) => {
    filter.columnId = columnId;
    const newFilters = cloneDeep(filters);
    setFilters(newFilters);
  };

  const updateOperator = (value: FOperator) => {
    filter.operator = value;
    const newFilters = cloneDeep(filters);
    setFilters(newFilters);
  };
  const updateFieldValue = (value: unknown) => {
    filter.value = value;
    const newFilters = cloneDeep(filters);
    setFilters(newFilters);
  };

  return (
    <div className="flex items-center p-1">
      <Conjunction
        index={index}
        parent={parent}
        filters={filters}
        setFilter={setFilters}
      ></Conjunction>

      <section className="flex items-center">
        <FieldSelect columnId={filter.columnId} onSelect={selectField} />

        <OperatorSelect
          value={filter.operator}
          onSelect={updateOperator}
          columnId={filter.columnId as string}
        />

        <FieldValue filter={filter} onSelect={updateFieldValue}></FieldValue>

        <Button variant="outline" onClick={deleteItem} className="bg-white">
          <AshBin className="h-4 w-4"></AshBin>
        </Button>
      </section>
    </div>
  );
}

export { Condition };
