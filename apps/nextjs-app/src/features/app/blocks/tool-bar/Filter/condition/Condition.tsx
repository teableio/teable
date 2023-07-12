import type { IFilterMetaOperator, IFilterMeta } from '@teable-group/core';
import AshBin from '@teable-group/ui-lib/icons/app/ashbin.svg';
import { Button } from '@teable-group/ui-lib/shadcn/ui/button';
import { cloneDeep, isEqual } from 'lodash';
import { useContext } from 'react';
import { FilterContext } from '../context';
import type { IConditionProps } from '../types';
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

  const deleteFilter = () => {
    parent.filterSet.splice(index, 1);
    const newFilters = cloneDeep(filters);
    setFilters(newFilters);
  };

  const fieldTypeHandler = (fieldId: string) => {
    filter.fieldId = fieldId;
    // TODO: allow the same type field to remain the value
    filter.value = null;
    const newFilters = cloneDeep(filters);
    setFilters(newFilters);
  };
  const operatorHandler = (value: IFilterMetaOperator) => {
    filter.operator = value;
    const newFilters = cloneDeep(filters);
    setFilters(newFilters);
  };
  const fieldValueHandler = (value: IFilterMeta['value']) => {
    if (!isEqual(filter.value, value)) {
      filter.value = value;
      const newFilters = cloneDeep(filters);
      setFilters(newFilters);
    }
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
        <FieldSelect fieldId={filter.fieldId} onSelect={fieldTypeHandler} />

        <OperatorSelect
          value={filter.operator}
          onSelect={operatorHandler}
          fieldId={filter.fieldId}
        />

        <FieldValue filter={filter} onSelect={fieldValueHandler}></FieldValue>

        <Button variant="outline" onClick={deleteFilter} className="dark:bg-white">
          <AshBin className="h-4 w-4"></AshBin>
        </Button>
      </section>
    </div>
  );
}

export { Condition };
