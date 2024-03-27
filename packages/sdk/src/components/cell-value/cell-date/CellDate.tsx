import { DateFormattingPreset, formatDateToString } from '@teable/core';
import type { IDatetimeFormatting } from '@teable/core';
import { cn } from '@teable/ui-lib';
import dayjs from 'dayjs';
import { useMemo } from 'react';
import type { ICellValue } from '../type';

interface ICellDate extends ICellValue<string> {
  formatting?: IDatetimeFormatting | null;
}

export const CellDate = (props: ICellDate) => {
  const { value, formatting, className, style } = props;

  const displayValue = useMemo(() => {
    if (value == null) return '';
    if (formatting == null) return dayjs(value).format(DateFormattingPreset.ISO);
    return formatDateToString(value, formatting);
  }, [value, formatting]);

  return (
    <div className={cn('text-sm', className)} style={style}>
      {displayValue}
    </div>
  );
};
