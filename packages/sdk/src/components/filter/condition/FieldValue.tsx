import type { IFilterItem } from '@teable/core';

import { useContext } from 'react';

import { FilterContext } from '../context';
import { BaseFieldValue } from './BaseFieldValue';

interface IFieldValue {
  filter: IFilterItem;
  onSelect: (value: IFilterItem['value']) => void;
}

function FieldValue(props: IFieldValue) {
  const { filter, onSelect } = props;
  const { components, fields } = useContext(FilterContext);
  const field = fields.find((f) => f.id === filter.fieldId);

  return (
    <BaseFieldValue
      value={filter.value}
      components={components}
      field={field}
      operator={filter.operator}
      onSelect={onSelect}
    />
  );
}

export { FieldValue };
