import type { Colors } from '@teable-group/core';
import { ColorUtils } from '@teable-group/core';
import type { MultipleSelectField, SingleSelectField } from '@teable-group/sdk';

import { useMemo, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { BaseMultipleSelect } from './base';

interface IMutipleSelect {
  onSelect: (value: string[] | null) => void;
  value: string[] | null;
  // SingleSelectField used in MultipleSelect in filter scenario
  field: MultipleSelectField | SingleSelectField;
}
interface IColorOption {
  value: string;
  label: string;
  color: Colors;
}

const MultipleSelect = (props: IMutipleSelect) => {
  const { field, value, onSelect } = props;
  const values = useMemo(() => {
    if (Array.isArray(value) && value.length) {
      return value;
    }
    return [];
  }, [value]);
  const options = useMemo<IColorOption[]>(() => {
    return field?.options?.choices.map((choice) => ({
      value: choice.name,
      label: choice.name,
      color: choice.color,
    }));
  }, [field]);
  useEffect(() => {
    // other type value comes, adapter or reset
    const isNull = value === null;
    const isArray = Array.isArray(value);
    const isContainOption = !isArray
      ? false
      : values.every((value) => options.map((option) => option?.value).includes(value));
    if ((!isNull && !isArray) || !isContainOption) {
      onSelect?.(null);
    }
  }, [onSelect, options, value, values]);
  const displayRender = (value: IColorOption) => {
    return (
      <div
        key={value?.value}
        className={cn('px-2 rounded-lg m-1')}
        style={{
          backgroundColor: ColorUtils.getHexForColor(value.color),
          color: ColorUtils.shouldUseLightTextOnColor(value.color) ? '#ffffff' : '#000000',
        }}
      >
        {value.label}
      </div>
    );
  };

  return (
    <BaseMultipleSelect
      options={options}
      onSelect={onSelect}
      value={values}
      displayRender={displayRender}
      optionRender={displayRender}
      popoverClassName="w-40"
    />
  );
};

MultipleSelect.displayName = 'MultipleSelect';

export { MultipleSelect };
