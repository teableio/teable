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
import React, { useMemo, useState, useRef } from 'react';
import { tableConfig } from '@/features/i18n/table.config';
import { TableImport } from '../import-table';

interface ITableOperationProps {
  className?: string;
  table: Table;
  onRename?: () => void;
}

export const TableOperation = (props: ITableOperationProps) => {
  const { table, className, onRename } = props;
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [importVisible, setImportVisible] = useState(false);
  const [importType, setImportType] = useState(SUPPORTEDTYPE.CSV);
  const base = useBase();
  const tables = useTables();
  const router = useRouter();
  const { baseId, tableId: routerTableId } = router.query;
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const menuPermission = useMemo(() => {
    return {
      deleteTable: table.permission?.['table|delete'],
    };
  }, [table.permission]);

  const deleteTable = async () => {
    const tableId = table?.id;
    if (!tableId) {
      return;
    }
    await base.deleteTable(tableId);
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
      {menuPermission.deleteTable && (
        <DropdownMenu>
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
            {table.permission?.['table|update'] && (
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
            {table.permission?.['table|export'] && (
              <DropdownMenuItem
                onClick={() => {
                  if (iframeRef.current) {
                    iframeRef.current.src = `/api/export/${table.id}`;
                  }
                }}
              >
                <Export className="mr-2" />
                {t('table:import.menu.downAsCsv')}
              </DropdownMenuItem>
            )}
            {table.permission?.['table|import'] && (
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
            {table.permission?.['table|delete'] && (
              <DropdownMenuItem className="text-destructive" onClick={() => setDeleteConfirm(true)}>
                <Trash2 className="mr-2" />
                {t('common:actions.delete')}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

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
      <iframe ref={iframeRef} title="This for export csv download" style={{ display: 'none' }} />
    </div>
  );
};
