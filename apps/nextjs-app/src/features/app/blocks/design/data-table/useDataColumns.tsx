import type { ColumnDef } from '@tanstack/react-table';
import type { IFieldVo } from '@teable/core';
import { Checked, Lock } from '@teable/icons';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { Actions } from '../components/Actions';
import { FieldPropertyEditor } from '../components/FieldPropertyEditor';
import { FieldGraph } from './FieldGraph';

function checkBox(key: string) {
  return {
    accessorKey: key,
    header: key,
    cell: ({ row }: { row: { getValue: (key: string) => boolean } }) =>
      row.getValue(key) && <Checked className="size-5" />,
  };
}

export function useDataColumns() {
  const { t } = useTranslation(['sdk']);
  const columns: ColumnDef<IFieldVo>[] = [
    {
      accessorKey: 'isPrimary',
      header: '',
      cell: ({ row }) =>
        row.getValue('isPrimary') && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <Lock className="size-5" />
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <pre>{t('hidden.primaryKey')}</pre>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ),
    },
    {
      accessorKey: 'id',
      header: 'id',
    },
    {
      accessorKey: 'name',
      header: 'name',
      maxSize: 500,
      cell: ({ row }) => <FieldPropertyEditor fieldId={row.getValue('id')} propKey="name" />,
    },
    {
      accessorKey: 'dbFieldName',
      header: 'dbFieldName',
      cell: ({ row }) => <FieldPropertyEditor fieldId={row.getValue('id')} propKey="dbFieldName" />,
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
      header: '',
      enableHiding: false,
      cell: ({ row }) => <Actions fieldId={row.getValue('id')} />,
    },
  ];
  return columns;
}
