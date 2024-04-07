import { FieldType, getValidFilterOperators } from '@teable/core';
import type { IOperator, IFilterItem } from '@teable/core';

import { Trash2 } from '@teable/icons';
import { Button } from '@teable/ui-lib';

import { isEqual } from 'lodash';
import { useContext, useMemo } from 'react';

import type { IFieldInstance } from '../../../model';
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
  const { setFilters, deleteCondition, fields } = context;
  const fieldMap = useMemo(() => {
    const map: Record<string, IFieldInstance> = {};
    fields.forEach((field) => {
      const key = field.id;
      const value = field;
      map[key] = value;
    });
    return map;
  }, [fields]);

  const fieldTypeHandler = (newFieldId: string | null) => {
    const newField = fieldMap[newFieldId!];
    const newFieldType = newField.type;
    const currentFieldType = fieldMap[fieldId].type || null;
    const newFieldPath = [...path, 'fieldId'];
    const newValuePath = [...path, 'value'];
    // different type should reset value to null.
    if (
      newFieldType !== currentFieldType ||
      [FieldType.Link, FieldType.SingleSelect, FieldType.MultipleSelect].includes(currentFieldType)
    ) {
      setFilters(newValuePath, null);
    }
    // repair operator if not valid
    const newOperators = newField ? getValidFilterOperators(newField) : null;
    if (!newOperators?.includes(operator as IOperator)) {
      const newPath = [...path, 'operator'];
      setFilters(newPath, newOperators?.[0] ?? null);
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

  if (fields.length > 0 && !fields.some((field) => field.id === fieldId)) {
    deleteCondition(path, index);
  }

  return (
    <div className="my-1 flex items-center px-1">
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
          <Trash2 className="size-4"></Trash2>
        </Button>
      </section>
    </div>
  );
}

export { Condition };
