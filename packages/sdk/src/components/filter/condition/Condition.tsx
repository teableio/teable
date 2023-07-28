import type { IFilterItem } from '@teable-group/core';

import { Trash2 } from '@teable-group/icons';
import { Button } from '@teable-group/ui-lib';

import { isEqual } from 'lodash';
import { useContext, useMemo } from 'react';
import { useFields } from '../../../hooks';

import { FilterContext } from '../context';
import type { IConditionProps } from '../types';
import { Conjunction } from './Conjunction';
import { FieldSelect } from './FieldSelect';
import { FieldValue } from './FieldValue';
import { OperatorSelect } from './OperatorSelect';

function Condition(props: IConditionProps) {
  const { index, filter, path, conjunction } = props;
  const context = useContext(FilterContext);
  const { setFilters, deleteCondition } = context;
  const fields = useFields();
  const fieldMap = useMemo(() => {
    const map: Record<string, string> = {};
    fields.forEach((field) => {
      const key = field.id;
      const value = field.type;
      map[key] = value;
    });
    return map;
  }, [fields]);

  const fieldTypeHandler = (fieldId: string | null) => {
    const newFieldType = fieldMap[fieldId!] || null;
    const currentFieldType = fieldMap[filter.fieldId] || null;
    if (newFieldType !== currentFieldType) {
      filter.value = null;
    }
    const newPath = [...path, 'fieldId'];
    setFilters(newPath, fieldId);
  };
  const operatorHandler = (value: string | null) => {
    if (filter.operator !== value) {
      const newPath = [...path, 'operator'];
      setFilters(newPath, value);
    }
  };
  const fieldValueHandler = (value: IFilterItem['value']) => {
    if (!isEqual(filter.value, value)) {
      let newValue = value ?? null;
      // empty array should be null!
      if (Array.isArray(value) && !value.length) {
        newValue = null;
      }
      const newPath = [...path, 'value'];
      setFilters(newPath, newValue);
    }
  };

  return (
    <div className="flex items-center px-1">
      <Conjunction
        index={index}
        value={conjunction}
        onSelect={(value) => {
          const newPath = [...path];
          newPath.splice(-2, 2, 'conjunction');
          setFilters(newPath, value);
        }}
      ></Conjunction>

      <section className="flex items-center">
        <FieldSelect fieldId={filter.fieldId} onSelect={fieldTypeHandler} />

        <OperatorSelect
          value={filter.operator}
          onSelect={operatorHandler}
          fieldId={filter.fieldId}
        />

        <FieldValue filter={filter} onSelect={fieldValueHandler}></FieldValue>

        <Button
          variant="outline"
          size="sm"
          onClick={() => deleteCondition(path, index)}
          className="ml-1"
        >
          <Trash2 className="h-4 w-4"></Trash2>
        </Button>
      </section>
    </div>
  );
}

export { Condition };
