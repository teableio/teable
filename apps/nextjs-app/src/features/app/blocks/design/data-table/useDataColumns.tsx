import { DotsHorizontalIcon } from '@radix-ui/react-icons';
import type { ColumnDef } from '@tanstack/react-table';
import type { IFieldVo } from '@teable-group/core';
import { Checked, Lock } from '@teable-group/icons';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  Button,
  DropdownMenuContent,
  DropdownMenuItem,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable-group/ui-lib/shadcn';
import { FieldGraph } from './FieldGraph';

function checkBox(key: string) {
  return {
    accessorKey: key,
    header: key,
    cell: ({ row }: { row: { getValue: (key: string) => boolean } }) =>
      row.getValue(key) && <Checked className="h-5 w-5" />,
  };
}

export function useDataColumns() {
  const columns: ColumnDef<IFieldVo>[] = [
    {
      accessorKey: 'isPrimary',
      header: () => (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <Lock className="h-5 w-5" />
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>is primary key</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ),
      cell: ({ row }) => row.getValue('isPrimary') && <Checked className="h-5 w-5" />,
    },
    {
      accessorKey: 'id',
      header: 'id',
    },
    {
      accessorKey: 'name',
      header: 'name',
      maxSize: 500,
      cell: ({ row }) => <div className="text-nowrap">{row.getValue('name')}</div>,
    },
    {
      accessorKey: 'dbFieldName',
      header: 'dbFieldName',
    },
    {
      accessorKey: 'type',
      header: 'type',
    },
    {
      accessorKey: 'description',
      header: 'description',
      cell: ({ row }) => (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="max-w-[150px] overflow-hidden text-ellipsis text-nowrap">
                {row.getValue('description')}
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <pre>{row.getValue('description')}</pre>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ),
    },
    {
      header: 'graph',
      cell: ({ row }) => <FieldGraph fieldId={row.getValue('id')} />,
    },
    {
      accessorKey: 'dbFieldType',
      header: 'dbFieldType',
    },
    {
      accessorKey: 'cellValueType',
      header: 'cellValueType',
    },
    checkBox('isLookup'),
    checkBox('isMultipleCellValue'),
    checkBox('isComputed'),
    checkBox('isPending'),
    checkBox('hasError'),
    checkBox('notNull'),
    checkBox('unique'),
    {
      id: 'actions',
      enableHiding: false,
      cell: ({ row }) => {
        const payment = row.original;

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <span className="sr-only">Open menu</span>
                <DotsHorizontalIcon className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => navigator.clipboard.writeText(payment.id)}>
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigator.clipboard.writeText(payment.id)}>
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];
  return columns;
}
