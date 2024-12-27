import { useQueryClient } from '@tanstack/react-query';
import {
  MoreHorizontal,
  Pencil,
  Settings,
  Trash2,
  Export,
  Import,
  FileCsv,
  FileExcel,
} from '@teable/icons';
import { SUPPORTEDTYPE } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBase, useTables } from '@teable/sdk/hooks';
import type { Table } from '@teable/sdk/model';
import { ConfirmDialog } from '@teable/ui-lib/base';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuPortal,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@teable/ui-lib/shadcn';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import React, { useMemo, useState } from 'react';
import { tableConfig } from '@/features/i18n/table.config';
import { useDownload } from '../../hooks/useDownLoad';
import { TableImport } from '../import-table';

interface ITableOperationProps {
  className?: string;
  table: Table;
  onRename?: () => void;
  open?: boolean;
  setOpen?: (open: boolean) => void;
}

export const TableOperation = (props: ITableOperationProps) => {
  const { table, className, onRename, open, setOpen } = props;
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [importVisible, setImportVisible] = useState(false);
  const [importType, setImportType] = useState(SUPPORTEDTYPE.CSV);
  const base = useBase();
  const tables = useTables();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { baseId, tableId: routerTableId } = router.query;
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const { trigger } = useDownload({ downloadUrl: `/api/export/${table.id}`, key: 'table' });

  const menuPermission = useMemo(() => {
    return {
      deleteTable: table.permission?.['table|delete'],
      updateTable: table.permission?.['table|update'],
      exportTable: table.permission?.['table|export'],
      importTable: table.permission?.['table|import'],
    };
  }, [table.permission]);

  const deleteTable = async () => {
    const tableId = table?.id;

    if (!tableId) return;

    await base.deleteTable(tableId);
    queryClient.invalidateQueries(ReactQueryKeys.getTrashItems(baseId as string));

    const firstTableId = tables.find((t) => t.id !== tableId)?.id;
    if (routerTableId === tableId) {
      router.push(
        firstTableId
          ? {
              pathname: '/base/[baseId]/[tableId]',
              query: { baseId, tableId: firstTableId },
            }
          : {
              pathname: '/base/[baseId]',
              query: { baseId },
            }
      );
    }
  };

  if (!Object.values(menuPermission).some(Boolean)) {
    return null;
  }

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div onMouseDown={(e) => e.stopPropagation()}>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <div>
            <MoreHorizontal className={className} />
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="min-w-[160px]"
          onClick={(e) => e.stopPropagation()}
        >
          {menuPermission.updateTable && (
            <DropdownMenuItem onClick={() => onRename?.()}>
              <Pencil className="mr-2" />
              {t('table:table.rename')}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild>
            <Link
              href={{
                pathname: '/base/[baseId]/[tableId]/design',
                query: { baseId, tableId: table.id },
              }}
              title={t('table:table.design')}
            >
              <Settings className="mr-2" />
              {t('table:table.design')}
            </Link>
          </DropdownMenuItem>
          {menuPermission.exportTable && (
            <DropdownMenuItem
              onClick={() => {
                trigger?.();
              }}
            >
              <Export className="mr-2" />
              {t('table:import.menu.downAsCsv')}
            </DropdownMenuItem>
          )}
          {menuPermission.importTable && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Import className="mr-2" />
                <span>{t('table:import.menu.importData')}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  <DropdownMenuItem
                    onClick={() => {
                      setImportVisible(true);
                      setImportType(SUPPORTEDTYPE.CSV);
                    }}
                  >
                    <FileCsv className="mr-2 size-4" />
                    <span>{t('table:import.menu.csvFile')}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      setImportVisible(true);
                      setImportType(SUPPORTEDTYPE.EXCEL);
                    }}
                  >
                    <FileExcel className="mr-2 size-4" />
                    <span>{t('table:import.menu.excelFile')}</span>
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          )}
          {menuPermission.deleteTable && (
            <DropdownMenuItem className="text-destructive" onClick={() => setDeleteConfirm(true)}>
              <Trash2 className="mr-2" />
              {t('common:actions.delete')}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {importVisible && (
        <TableImport
          open={importVisible}
          tableId={table.id}
          fileType={importType}
          onOpenChange={(open: boolean) => setImportVisible(open)}
        ></TableImport>
      )}

      <ConfirmDialog
        open={deleteConfirm}
        onOpenChange={setDeleteConfirm}
        title={t('table:table.deleteConfirm', { tableName: table?.name })}
        cancelText={t('common:actions.cancel')}
        confirmText={t('common:actions.confirm')}
        content={
          <div className="space-y-2 text-sm">
            <p>1. {t('table:table.deleteTip1')}</p>
            <p>2. {t('table:table.deleteTip2')}</p>
          </div>
        }
        onCancel={() => setDeleteConfirm(false)}
        onConfirm={deleteTable}
      />
    </div>
  );
};
