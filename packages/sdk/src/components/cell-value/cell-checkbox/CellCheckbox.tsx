import { cn, Checkbox } from '@teable/ui-lib';
import { useMemo } from 'react';
import type { ICellValue } from '../type';

interface ICellCheckbox extends ICellValue<boolean | boolean[]> {
  itemClassName?: string;
}

export const CellCheckbox = (props: ICellCheckbox) => {
  const { value, className, style, itemClassName } = props;

  const innerValue = useMemo(() => {
    if (value == null) return;
    if (Array.isArray(value)) return value;
    return [value];
  }, [value]);

  return (
    <div className={cn('flex gap-1 flex-wrap', className)} style={style}>
      {innerValue?.map((val, index) => {
        return (
          <Checkbox
            key={index}
            className={cn('size-5 cursor-default', itemClassName)}
            checked={Boolean(val)}
          />
        );
      })}
    </div>
  );
};
