import { useVirtualizer } from '@tanstack/react-virtual';
import { Command, CommandItem, CommandList, Separator, cn } from '@teable/ui-lib';
import React, { useEffect, useRef } from 'react';
import { useTranslation } from '../../context/app/i18n';
interface IRecordListProps {
  empty?: string | React.ReactNode;
  className?: string;
  itemClassName?: string;
  rowCount: number;
  isLoading?: boolean;
  itemHeight?: number;
  children?: React.ReactNode;
  itemRender: (index: number) => React.ReactNode;
  onSelect?: (index: number) => void;
  onVisibleChange?: (range: [number, number]) => void;
}

export const RecordList = (props: IRecordListProps) => {
  const {
    empty,
    rowCount,
    children,
    className,
    itemClassName,
    isLoading,
    itemHeight = 46,
    onSelect,
    itemRender,
    onVisibleChange,
  } = props;
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => listRef.current,
    estimateSize: () => itemHeight,
  });

  useEffect(() => {
    if (rowVirtualizer.range) {
      const { startIndex, endIndex } = rowVirtualizer.range;
      onVisibleChange?.([startIndex, endIndex]);
    }
  }, [onVisibleChange, rowVirtualizer.range]);

  return (
    <Command className={cn('flex flex-col', className)}>
      {children && (
        <div className="w-full">
          {children}
          <Separator className="my-2" />
        </div>
      )}
      {isLoading ? (
        <div className="flex h-full items-center justify-center">{t('common.loading')}</div>
      ) : (
        rowCount === 0 && (
          <div className="flex h-full items-center justify-center">
            {empty || t('common.noRecords')}
          </div>
        )
      )}
      <CommandList
        ref={listRef}
        className={cn('w-full flex-1 overflow-auto max-h-full', {
          'h-0': isLoading || rowCount > 0,
        })}
      >
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualItem) => (
            <CommandItem
              key={virtualItem.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualItem.size}px`,
                transform: `translateY(${virtualItem.start}px)`,
              }}
              className={itemClassName}
              value={virtualItem.key.toString()}
              onSelect={() => onSelect?.(virtualItem.index)}
            >
              {itemRender(virtualItem.index)}
            </CommandItem>
          ))}
        </div>
      </CommandList>
    </Command>
  );
};
