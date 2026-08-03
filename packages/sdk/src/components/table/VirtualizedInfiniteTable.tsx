import type { ColumnDef } from '@tanstack/react-table';
import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell, cn } from '@teable/ui-lib';
import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from '../../context/app/i18n';

export interface IVirtualizedInfiniteTableProps<T> {
  rows: T[];
  columns: ColumnDef<T>[];
  className?: string;
  hasNextPage?: boolean;
  fetchNextPage?: () => void;
}

export const VirtualizedInfiniteTable = <T extends { [key: string]: unknown }>(
  props: IVirtualizedInfiniteTableProps<T>
) => {
  const { rows, columns, className, fetchNextPage } = props;
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement>(null);

  const fetchMoreOnBottomReached = useCallback(
    (containerRefElement?: HTMLDivElement | null) => {
      if (containerRefElement) {
        const { scrollHeight, scrollTop, clientHeight } = containerRefElement;
        const isReachedThreshold = scrollHeight - scrollTop - clientHeight < 30;
        if (isReachedThreshold) {
          fetchNextPage?.();
        }
      }
    },
    [fetchNextPage]
  );

  useEffect(() => {
    fetchMoreOnBottomReached(listRef.current);
  }, [fetchMoreOnBottomReached]);

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const { rows: tableRows } = table.getRowModel();

  const rowVirtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 40,
    overscan: 3,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();

  return (
    <div
      ref={listRef}
      className={cn('relative size-full overflow-auto', className)}
      onScroll={(e) => fetchMoreOnBottomReached(e.target as HTMLDivElement)}
    >
      <Table className="relative scroll-smooth">
        <TableHeader className="sticky top-0 z-10 bg-background">
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow
              key={headerGroup.id}
              className="flex h-10 bg-background text-[13px] hover:bg-background"
            >
              {headerGroup.headers.map((header) => {
                return (
                  <TableHead
                    key={header.id}
                    className="flex items-center px-0"
                    style={{
                      width: header.getSize(),
                    }}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody
          style={{
            position: 'relative',
            height: `${rowVirtualizer.getTotalSize()}px`,
          }}
        >
          {virtualRows?.length ? (
            <>
              {virtualRows.map((virtualRow) => {
                const row = tableRows[virtualRow.index];

                if (!row) return null;

                return (
                  <TableRow
                    key={row.id}
                    className="flex text-[13px]"
                    style={{
                      height: `${virtualRow.size}px`,
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    {row.getVisibleCells().map((cell) => {
                      return (
                        <TableCell
                          key={cell.id}
                          className="flex h-10 items-center px-0"
                          style={{
                            width: cell.column.getSize(),
                          }}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })}
            </>
          ) : (
            <TableRow className="flex w-full">
              <TableCell
                colSpan={columns.length}
                className="h-20 w-full text-center leading-[64px] text-gray-500"
              >
                {t('common.empty')}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
};
