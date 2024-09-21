import type { ISelectFieldOptions } from '@teable/core';
import { ColorUtils } from '@teable/core';
import { cn } from '@teable/ui-lib';
import { keyBy } from 'lodash';
import { useMemo } from 'react';
import type { ICellValue } from '../type';
import { SelectTag } from './SelectTag';

export const transformSelectOptions = (choices: ISelectFieldOptions['choices']) => {
  return choices.map(({ name, color }) => ({
    label: name,
    value: name,
    color: ColorUtils.shouldUseLightTextOnColor(color) ? '#ffffff' : '#000000',
    backgroundColor: ColorUtils.getHexForColor(color),
  }));
};

export interface ISelectOption {
  label: string;
  value: string;
  color?: string;
  backgroundColor?: string;
}

interface ICellSelect extends ICellValue<string | string[]> {
  options?: ISelectOption[] | null;
  itemClassName?: string;
}

export const CellSelect = (props: ICellSelect) => {
  const { value, options, className, style, itemClassName } = props;

  const innerValue = useMemo(() => {
    if (value == null || Array.isArray(value)) return value;
    return [value];
  }, [value]);

  const optionMap = useMemo(() => {
    return keyBy(options, 'value');
  }, [options]);

  return (
    <div className={cn('flex gap-1 flex-wrap', className)} style={style}>
      {innerValue?.map((itemVal) => {
        const option = optionMap[itemVal];
        if (option == null) return null;
        const { label, value, color, backgroundColor } = option;
        return (
          <SelectTag
            key={value}
            label={label || 'Untitled'}
            color={color}
            backgroundColor={backgroundColor}
            className={itemClassName}
          />
        );
      })}
    </div>
  );
};
