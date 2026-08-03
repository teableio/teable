import { formatNumberToString } from '@teable/core';
import type { INumberFormatting } from '@teable/core';
import { cn } from '@teable/ui-lib';
import { useMemo } from 'react';
import { OverflowTooltip } from '../components';
import type { ICellValue } from '../type';

interface ICellNumber extends ICellValue<number | number[]> {
  formatting?: INumberFormatting;
}

export const CellNumber = (props: ICellNumber) => {
  const { value, formatting, ellipsis, className, style } = props;

  const displayValue = useMemo(() => {
    if (value == null) return;

    if (Array.isArray(value)) {
      return value
        .map((v) => (formatting ? formatNumberToString(v, formatting) : String(v)))
        .join(', ');
    }
    return formatting ? formatNumberToString(value, formatting) : String(value);
  }, [formatting, value]);

  return (
    <OverflowTooltip
      text={displayValue}
      ellipsis={ellipsis}
      className={cn('w-full text-[13px] leading-5', className)}
      style={style}
    />
  );
};
