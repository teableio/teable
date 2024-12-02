import { DateFormattingPreset, formatDateToString } from '@teable/core';
import type { IDatetimeFormatting } from '@teable/core';
import { cn } from '@teable/ui-lib';
import dayjs from 'dayjs';
import { useMemo } from 'react';
import { OverflowTooltip } from '../components';
import type { ICellValue } from '../type';

interface ICellDate extends ICellValue<string> {
  formatting?: IDatetimeFormatting | null;
}

export const CellDate = (props: ICellDate) => {
  const { value, formatting, ellipsis, className, style } = props;

  const displayValue = useMemo(() => {
    if (value == null) return '';
    if (formatting == null) return dayjs(value).format(DateFormattingPreset.ISO);
    return formatDateToString(value, formatting);
  }, [value, formatting]);

  return (
    <OverflowTooltip
      text={displayValue}
      ellipsis={ellipsis}
      className={cn('w-full text-[13px] leading-5', className)}
      style={style}
    />
  );
};
