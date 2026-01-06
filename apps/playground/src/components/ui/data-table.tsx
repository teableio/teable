'use client';

import {
  type ColumnDef,
  type ColumnPinningState,
  type OnChangeFn,
  type PaginationState,
  type RowSelectionState,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useMemo } from 'react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

/** Pagination info for server-side pagination */
export interface DataTablePagination {
  /** Current page index (0-based) */
  pageIndex: number;
  /** Number of rows per page */
  pageSize: number;
  /** Total number of rows (for server-side pagination) */
  total: number;
}

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
  /** Server-side pagination state */
  pagination?: DataTablePagination;
  /** Callback when pagination changes */
  onPaginationChange?: (pagination: { pageIndex: number; pageSize: number }) => void;
  /** Available page sizes */
  pageSizeOptions?: number[];
  /** Enable row selection */
  enableRowSelection?: boolean;
  /** Controlled row selection */
  rowSelection?: RowSelectionState;
  /** Callback when row selection changes */
  onRowSelectionChange?: OnChangeFn<RowSelectionState>;
  /** Get row id for stable selection */
  getRowId?: (originalRow: TData, index: number) => string;
}

export function DataTable<TData, TValue>({
  columns,
  data,
  emptyMessage = 'No results.',
  caption,
  className,
  pinnedColumns,
  pagination,
  onPaginationChange,
  pageSizeOptions = [10, 20, 50, 100],
  enableRowSelection,
  rowSelection,
  onRowSelectionChange,
  getRowId,
}: DataTableProps<TData, TValue>) {
  const columnPinning = useMemo<ColumnPinningState>(
    () => ({
      left: pinnedColumns?.left ?? [],
      right: pinnedColumns?.right ?? [],
    }),
    [pinnedColumns]
  );

  // Server-side pagination state
  const paginationState = useMemo<PaginationState | undefined>(
    () =>
      pagination
        ? {
            pageIndex: pagination.pageIndex,
            pageSize: pagination.pageSize,
          }
        : undefined,
    [pagination]
  );

  const pageCount = pagination ? Math.ceil(pagination.total / pagination.pageSize) : -1;

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    // Server-side pagination
    manualPagination: Boolean(pagination),
    pageCount,
    enableRowSelection: Boolean(enableRowSelection),
    state: {
      columnPinning,
      ...(paginationState && { pagination: paginationState }),
      ...(rowSelection && { rowSelection }),
    },
    onPaginationChange: onPaginationChange
      ? (updater) => {
          const newState =
            typeof updater === 'function'
              ? updater(paginationState ?? { pageIndex: 0, pageSize: 10 })
              : updater;
          onPaginationChange(newState);
        }
      : undefined,
    onRowSelectionChange: onRowSelectionChange,
    getRowId,
  });

  return (
    <div className={cn('w-full space-y-4 min-w-0', className)}>
      <div className="rounded-sm border overflow-x-auto max-w-full">
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

      {/* Pagination controls */}
      {pagination && onPaginationChange && (
        <div className="flex items-center justify-between px-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>
              {pagination.total > 0
                ? `${pagination.pageIndex * pagination.pageSize + 1}-${Math.min(
                    (pagination.pageIndex + 1) * pagination.pageSize,
                    pagination.total
                  )} of ${pagination.total}`
                : '0 records'}
            </span>
          </div>

          <div className="flex items-center gap-6">
            {/* Page size selector */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Rows per page</span>
              <Select
                value={String(pagination.pageSize)}
                onValueChange={(value) =>
                  onPaginationChange({ pageIndex: 0, pageSize: Number(value) })
                }
              >
                <SelectTrigger className="h-8 w-[70px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {pageSizeOptions.map((size) => (
                    <SelectItem key={size} value={String(size)}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Page navigation */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                Page {pagination.pageIndex + 1} of {Math.max(pageCount, 1)}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => table.setPageIndex(0)}
                  disabled={!table.getCanPreviousPage()}
                >
                  <ChevronsLeft className="h-4 w-4" />
                  <span className="sr-only">First page</span>
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => table.previousPage()}
                  disabled={!table.getCanPreviousPage()}
                >
                  <ChevronLeft className="h-4 w-4" />
                  <span className="sr-only">Previous page</span>
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => table.nextPage()}
                  disabled={!table.getCanNextPage()}
                >
                  <ChevronRight className="h-4 w-4" />
                  <span className="sr-only">Next page</span>
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                  disabled={!table.getCanNextPage()}
                >
                  <ChevronsRight className="h-4 w-4" />
                  <span className="sr-only">Last page</span>
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
