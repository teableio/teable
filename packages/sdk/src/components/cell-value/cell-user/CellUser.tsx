import type { IUserCellValue } from '@teable/core';
import { cn } from '@teable/ui-lib';
import { useMemo } from 'react';
import type { ICellValue } from '../type';
import { UserTag } from './UserTag';

interface ICellUser extends ICellValue<IUserCellValue | IUserCellValue[]> {
  itemClassName?: string;
  formatImageUrl?: (url: string) => string;
}

export const CellUser = (props: ICellUser) => {
  const { value, className, style, itemClassName, formatImageUrl } = props;

  const innerValue = useMemo(() => {
    if (value == null || Array.isArray(value)) return value;
    return [value];
  }, [value]);

  return (
    <div className={cn('flex gap-1 flex-wrap', className)} style={style}>
      {innerValue?.map((itemVal) => {
        const { id, title, avatarUrl } = itemVal;
        return (
          <UserTag
            key={id}
            name={title}
            avatar={avatarUrl}
            className={itemClassName}
            formatImageUrl={formatImageUrl}
          />
        );
      })}
    </div>
  );
};
