import type { IFilterItem, FieldType } from '@teable-group/core';

import { Trash2 } from '@teable-group/icons';
import { Button } from '@teable-group/ui-lib';

import { cloneDeep, isEqual } from 'lodash';
import { useCallback, useContext, useRef, useMemo } from 'react';
import { useFields } from '../../../hooks';

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
  const fields = useFields();
  const fieldType = useRef<FieldType | null>(null);
  const fieldMap = useMemo(() => {
    const map: Record<string, string> = {};
    fields.forEach((field) => {
      const key = field.id;
      const value = field.type;
      map[key] = value;
    });
    return map;
  }, [fields]);

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
      const newFieldType = fieldMap[fieldId!] || null;
      const lastFieldType = fieldType.current;
      fieldType.current = newFieldType;
      if (newFieldType !== lastFieldType) {
        filter.value = null;
      }
      filter.fieldId = fieldId as string;
      const newFilters = cloneDeep(filters);
      setFilters(newFilters);
    },
    [fieldMap, filter, filters, setFilters]
  );
  const operatorHandler = useCallback(
    (value: string | null) => {
      if (filter.operator !== value) {
        filter.operator = value as IFilterItem['operator'];
        const newFilters = cloneDeep(filters);
        setFilters(newFilters);
      }
    },
    [filter, filters, setFilters]
  );
  const fieldValueHandler = useCallback(
    (value: IFilterItem['value']) => {
      if (!isEqual(filter.value, value)) {
        filter.value = value || null;
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
    <div className="flex items-center px-1">
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

        <Button variant="outline" size="sm" onClick={deleteCurrentFilter} className="ml-1">
          <Trash2 className="h-4 w-4"></Trash2>
        </Button>
      </section>
    </div>
  );
}

export { Condition };
