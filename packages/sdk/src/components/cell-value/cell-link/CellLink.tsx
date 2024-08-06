import type { ILinkCellValue } from '@teable/core';
import { cn } from '@teable/ui-lib';
import { useMemo } from 'react';
import type { ICellValue } from '../type';

interface ICellLink extends ICellValue<ILinkCellValue | ILinkCellValue[]> {
  itemClassName?: string;
}

export const CellLink = (props: ICellLink) => {
  const { value, className, style, itemClassName } = props;

  const innerValue = useMemo(() => {
    if (value == null || Array.isArray(value)) return value;
    return [value];
  }, [value]);

  return (
    <div className={cn('flex gap-1 flex-wrap', className)} style={style}>
      {innerValue?.map((itemVal) => {
        const { id, title = 'Unnamed record' } = itemVal;
        return (
          <span
            key={id}
            title={title}
            className={cn(
              'text-[13px] rounded-md bg-secondary px-2 h-6 leading-6 truncate',
              itemClassName
            )}
          >
            {title}
          </span>
        );
      })}
    </div>
  );
};
