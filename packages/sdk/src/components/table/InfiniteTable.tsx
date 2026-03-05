import type { ColumnDef, SortingState, OnChangeFn } from '@tanstack/react-table';
import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { TableHeader, TableRow, TableHead, TableBody, TableCell, Table, cn } from '@teable/ui-lib';
import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from '../../context/app/i18n';

interface IInfiniteTableProps<T> {
  rows: T[];
  columns: ColumnDef<T>[];
  className?: string;
  fetchNextPage?: () => void;
  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;
  emptyText?: string;
}

export const InfiniteTable = <T extends { [key: string]: unknown }>(
  props: IInfiniteTableProps<T>
) => {
  const { rows, columns, className, fetchNextPage, sorting, onSortingChange, emptyText } = props;

  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement>(null);

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    ...(onSortingChange && {
      manualSorting: true,
      onSortingChange,
      state: { sorting },
    }),
  });

  const fetchMoreOnBottomReached = useCallback(
    (containerRefElement?: HTMLDivElement | null) => {
      if (containerRefElement) {
        const { scrollHeight, scrollTop, clientHeight } = containerRefElement;
        const isReachedThreshold = scrollHeight - scrollTop - clientHeight < 30;

        if (!isReachedThreshold) return;

        fetchNextPage?.();
      }
    },
    [fetchNextPage]
  );

  useEffect(() => {
    fetchMoreOnBottomReached(listRef.current);
  }, [fetchMoreOnBottomReached]);

  return (
    <div
      ref={listRef}
      className={cn('relative size-full overflow-auto', className)}
      onScroll={(e) => fetchMoreOnBottomReached(e.target as HTMLDivElement)}
    >
      <Table className="relative scroll-smooth">
        <TableHeader className="sticky top-0 z-10 bg-muted">
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow
              key={headerGroup.id}
              className="flex h-10 bg-muted text-[13px] hover:bg-muted"
            >
              {headerGroup.headers.map((header) => {
                const width = header.getSize();
                const isAutoSize = width === Number.MAX_SAFE_INTEGER;
                return (
                  <TableHead
                    key={header.id}
                    className={cn('flex items-center px-4', isAutoSize && 'flex-1')}
                    style={{
                      minWidth: header.column.columnDef.minSize,
                      width: isAutoSize ? undefined : width,
                    }}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id} className="flex text-[13px]">
                {row.getVisibleCells().map((cell) => {
                  const width = cell.column.getSize();
                  const isAutoSize = width === Number.MAX_SAFE_INTEGER;
                  return (
                    <TableCell
                      key={cell.id}
                      className={cn(
                        'flex min-h-[40px] items-center px-4 overflow-hidden',
                        isAutoSize && 'flex-1'
                      )}
                      style={{
                        minWidth: cell.column.columnDef.minSize,
                        width: isAutoSize ? undefined : width,
                      }}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center">
                {emptyText ?? t('common.empty')}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
};
