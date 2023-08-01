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
  const { fieldId, value, operator } = filter;
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

  const fieldTypeHandler = (newFieldId: string | null) => {
    const newFieldType = newFieldId ? fieldMap[newFieldId] : null;
    const currentFieldType = fieldMap[fieldId] || null;
    const newFieldPath = [...path, 'fieldId'];
    const newValuePath = [...path, 'value'];
    // different type should reset value to null.
    if (newFieldType !== currentFieldType) {
      setFilters(newValuePath, null);
    }
    setFilters(newFieldPath, newFieldId);
  };
  const operatorHandler = (value: string | null) => {
    if (operator !== value) {
      const newPath = [...path, 'operator'];
      setFilters(newPath, value);
    }
  };
  const fieldValueHandler = (newValue: IFilterItem['value']) => {
    if (isEqual(value, newValue)) {
      return;
    }

    let mergedValue = null;

    // empty array and string should be null!
    if (newValue !== '' && !(Array.isArray(newValue) && !newValue.length)) {
      mergedValue = newValue;
    }

    const newPath = [...path, 'value'];
    setFilters(newPath, mergedValue);
  };

  return (
    <div className="flex items-center px-1 my-1">
      <Conjunction
        index={index}
        value={conjunction}
        onSelect={(value) => {
          const newPath = [...path];
          newPath.splice(-2, 2, 'conjunction');
          setFilters(newPath, value);
        }}
      ></Conjunction>

      <section className="flex items-center pl-1">
        <FieldSelect fieldId={fieldId} onSelect={fieldTypeHandler} />

        <OperatorSelect value={operator} fieldId={fieldId} onSelect={operatorHandler} />

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
