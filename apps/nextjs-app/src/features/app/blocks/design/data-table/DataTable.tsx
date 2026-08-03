import type { ColumnFiltersState, SortingState, VisibilityState } from '@tanstack/react-table';
import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { useFields } from '@teable/sdk/hooks';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import * as React from 'react';
import { baseConfig } from '@/features/i18n/base.config';
import { useDataColumns } from './useDataColumns';

export function DataTable() {
  const columns = useDataColumns();
  const fields = useFields();
  const [rowSelection, setRowSelection] = React.useState({});
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const { t } = useTranslation(baseConfig.i18nNamespaces);
  const table = useReactTable({
    data: fields,
    columns,
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      columnFilters,
    },
    columnResizeMode: 'onChange',
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <Table>
      <TableHeader>
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id}>
            {headerGroup.headers.map((header) => {
              return (
                <TableHead key={header.id} colSpan={header.colSpan}>
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
            <TableRow key={row.id} data-state={row.getIsSelected() && 'selected'}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))
        ) : (
          <TableRow>
            <TableCell colSpan={columns.length} className="h-24 text-center">
              {t('noResult')}
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
