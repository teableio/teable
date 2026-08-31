import type { ILinkCellValue } from '@teable/core';
import { cn } from '@teable/ui-lib';
import { useMemo } from 'react';
import { useTranslation } from '../../../context/app/i18n';
import { useContentDir } from '../../../hooks/use-content-dir';
import type { ICellValue } from '../type';

interface ICellLink extends ICellValue<ILinkCellValue | ILinkCellValue[]> {
  itemClassName?: string;
  ellipsis?: boolean;
  deletedRecordIds?: string[];
}

export const CellLink = (props: ICellLink) => {
  const { value, className, style, itemClassName, ellipsis, deletedRecordIds } = props;
  const { t } = useTranslation();
  const contentDir = useContentDir();

  const innerValue = useMemo(() => {
    if (value == null || Array.isArray(value)) return value;
    return [value];
  }, [value]);

  return (
    <div
      className={cn(
        'flex gap-1',
        ellipsis ? 'flex-nowrap overflow-hidden' : 'flex-wrap',
        className
      )}
      style={style}
    >
      {innerValue?.map((itemVal) => {
        const { id, title = 'Unnamed record' } = itemVal;
        const isDeleted = deletedRecordIds?.includes(id);
        const text = isDeleted ? t('common.recordDeleted') : title;
        return (
          <span
            key={id}
            dir={contentDir}
            title={text}
            className={cn(
              'text-[13px] rounded-md bg-secondary px-2 h-6 leading-6 truncate',
              isDeleted && 'text-muted-foreground',
              itemClassName
            )}
          >
            {text}
          </span>
        );
      })}
    </div>
  );
};
