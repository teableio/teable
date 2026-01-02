'use client';

import {
  type ColumnDef,
  type ColumnPinningState,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { useMemo } from 'react';

import { cn } from '@/lib/utils';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  emptyMessage?: string;
  caption?: React.ReactNode;
  className?: string;
  pinnedColumns?: {
    left?: string[];
    right?: string[];
  };
}

export function DataTable<TData, TValue>({
  columns,
  data,
  emptyMessage = 'No results.',
  caption,
  className,
  pinnedColumns,
}: DataTableProps<TData, TValue>) {
  const columnPinning = useMemo<ColumnPinningState>(
    () => ({
      left: pinnedColumns?.left ?? [],
      right: pinnedColumns?.right ?? [],
    }),
    [pinnedColumns]
  );

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    state: {
      columnPinning,
    },
  });

  return (
    <div className={cn('w-full', className)}>
      <div className="rounded-sm border overflow-auto">
        <table className="w-full min-w-max caption-bottom text-sm">
          {caption && <caption className="text-muted-foreground mt-4 text-xs">{caption}</caption>}
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header, index) => {
                  const isPinned = header.column.getIsPinned();
                  const isFirstColumn = index === 0;
                  return (
                    <TableHead
                      key={header.id}
                      className={cn(
                        isPinned && 'bg-background sticky',
                        isPinned === 'left' && 'left-0',
                        isPinned === 'right' && 'right-0',
                        isFirstColumn && isPinned && 'font-semibold'
                      )}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && 'selected'}
                  className="hover:bg-transparent"
                >
                  {row.getVisibleCells().map((cell, index) => {
                    const isPinned = cell.column.getIsPinned();
                    const isFirstColumn = index === 0;
                    return (
                      <TableCell
                        key={cell.id}
                        className={cn(
                          isPinned && 'bg-background sticky',
                          isPinned === 'left' && 'left-0',
                          isPinned === 'right' && 'right-0',
                          isFirstColumn && isPinned && 'font-medium'
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-sm text-muted-foreground"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </table>
      </div>
    </div>
  );
}
