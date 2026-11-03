import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getUniqName } from '@teable/core';
import { MoreHorizontal, Settings, Export, Import, FileCsv, FileExcel } from '@teable/icons';
import { duplicateTable, SUPPORTEDTYPE } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBase, useBasePermission, useTables } from '@teable/sdk/hooks';
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
  Switch,
  Label,
  Input,
} from '@teable/ui-lib/shadcn';
import { CopyPlus, Pen, Trash } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import React, { useMemo, useState } from 'react';
import { OperationPreviewPanel } from '@/features/app/components/operation-preview';
import { TableDeleteConfirmDialog } from '@/features/app/components/table-delete-confirm-dialog/TableDeleteConfirmDialog';
import { tableConfig } from '@/features/i18n/table.config';
import { useDownload } from '../../hooks/useDownLoad';
import { TableImport } from '../import-table';
import {
  markTableDeletedLocally,
  unmarkTableDeletedLocally,
} from '../table/hooks/stale-table-fallback';
import { TableDuplicateConversionWarning } from './TableDuplicateConversionWarning';
import { useTableDuplicatePreview } from './useTableDuplicatePreview';
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
  const [isDeleting, setIsDeleting] = useState(false);
  const [importVisible, setImportVisible] = useState(false);
  const [duplicateSetting, setDuplicateSetting] = useState(false);
  const [importType, setImportType] = useState(SUPPORTEDTYPE.CSV);
  const base = useBase();
  const permission = useBasePermission();
  const tables = useTables();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { baseId, tableId: routerTableId } = router.query;
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const { trigger } = useDownload({ downloadUrl: `/api/export/${table.id}`, key: 'table' });

  const defaultTableName = useMemo(
    () =>
      getUniqName(
        `${table?.name} ${t('space:baseModal.copy')}`,
        tables.map((t) => t.name)
      ),
    [t, table?.name, tables]
  );

  const [duplicateOption, setDuplicateOption] = useState({
    name: defaultTableName,
    includeRecords: true,
  });

  const menuPermission = useMemo(() => {
    return {
      deleteTable: table.permission?.['table|delete'],
      updateTable: table.permission?.['table|update'],
      duplicateTable: table.permission?.['table|read'] && permission?.['table|create'],
      exportTable: table.permission?.['table|export'],
      importTable: table.permission?.['table|import'],
    };
  }, [permission, table.permission]);

  const deleteTable = async (permanent?: boolean) => {
    const tableId = table?.id;

    if (!tableId || isDeleting) return;

    setIsDeleting(true);
    // Before the request, not after: the realtime deletion op can reach this
    // window ahead of the HTTP response, and stale-table recovery must know
    // the deletion is ours (see stale-table-fallback).
    markTableDeletedLocally(tableId);
    try {
      await base.deleteTable(tableId, permanent);
      setDeleteConfirm(false);

      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.getTrashItems(baseId as string) });

      const firstTableId = tables.find((t) => t.id !== tableId)?.id;
      if (routerTableId === tableId) {
        // replace, not push: the deleted table's URL must not stay in history
        // as the next Back target.
        router.replace(firstTableId ? `/base/${baseId}/table/${firstTableId}` : `/base/${baseId}`);
      }
    } catch {
      // Keep the dialog open so the deletion can be retried.
      unmarkTableDeletedLocally(tableId);
    } finally {
      setIsDeleting(false);
    }
  };

  const duplicatePreview = useTableDuplicatePreview(
    baseId as string,
    table.id,
    duplicateOption,
    duplicateSetting && Boolean(baseId)
  );

  const handleDuplicateClick = () => {
    setDuplicateOption((prev) => ({ ...prev, name: defaultTableName }));
    setDuplicateSetting(true);
  };

  const { mutateAsync: duplicateTableFn, isPending: isLoading } = useMutation({
    mutationFn: () => duplicateTable(baseId as string, table.id, duplicateOption),
    onSuccess: (data) => {
      const {
        data: { id },
      } = data;
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.tableList(baseId as string),
      });
      setDuplicateSetting(false);
      router.push(`/base/${baseId}/table/${id}`);
    },
  });

  if (!Object.values(menuPermission).some(Boolean)) {
    return null;
  }

  return (
    <>
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
              <Pen className="me-2 size-4" />
              {t('table:table.rename')}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild>
            <Link
              href={{
                pathname: '/base/[baseId]/design',
                query: { baseId, tableId: table.id },
              }}
              title={t('common:noun.design')}
            >
              <Settings className="me-2 size-4" />
              {t('common:noun.design')}
            </Link>
          </DropdownMenuItem>
          {menuPermission.duplicateTable && (
            <DropdownMenuItem
              disabled={isLoading}
              onClick={(e) => {
                e.preventDefault();
                handleDuplicateClick();
              }}
            >
              <CopyPlus className="me-2 size-4" />
              {t('table:import.menu.duplicate')}
            </DropdownMenuItem>
          )}
          {menuPermission.exportTable && (
            <DropdownMenuItem
              onClick={() => {
                trigger?.();
              }}
            >
              <Export className="me-2 size-4" />
              {t('table:import.menu.downAsCsv')}
            </DropdownMenuItem>
          )}
          {menuPermission.importTable && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Import className="me-2 size-4" />
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
                    <FileCsv className="me-2 size-4" />
                    <span>{t('table:import.menu.csvFile')}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      setImportVisible(true);
                      setImportType(SUPPORTEDTYPE.EXCEL);
                    }}
                  >
                    <FileExcel className="me-2 size-4" />
                    <span>{t('table:import.menu.excelFile')}</span>
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          )}
          {menuPermission.deleteTable && (
            <DropdownMenuItem className="text-destructive" onClick={() => setDeleteConfirm(true)}>
              <Trash className="me-2 size-4" />
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

      <TableDeleteConfirmDialog
        open={deleteConfirm}
        tableId={table.id}
        tableName={table?.name}
        isDeleting={isDeleting}
        mode="soft"
        onOpenChange={setDeleteConfirm}
        onConfirm={() => deleteTable()}
      />

      <ConfirmDialog
        open={duplicateSetting}
        onOpenChange={setDuplicateSetting}
        title={`${t('common:actions.duplicate')} ${table?.name}`}
        cancelText={t('common:actions.cancel')}
        confirmText={
          duplicatePreview.affectedFields?.length
            ? t('table:crossSpace.convertAndDuplicate')
            : t('common:actions.duplicate')
        }
        confirmDisabled={isLoading || !duplicatePreview.canConfirm}
        confirmLoading={isLoading}
        content={
          <div className="flex flex-col space-y-2 text-sm">
            <div className="flex flex-col gap-2">
              <Label>
                {t('common:noun.table')} {t('common:name')}
              </Label>
              <Input
                value={duplicateOption.name}
                onChange={(e) => {
                  const value = e.target.value;
                  setDuplicateOption((prev) => ({ ...prev, name: value }));
                }}
              />
            </div>

            <div className="flex items-center gap-1">
              <Switch
                id="include-record"
                checked={duplicateOption.includeRecords}
                onCheckedChange={(val) => {
                  setDuplicateOption((prev) => ({ ...prev, includeRecords: val }));
                }}
              />
              <Label htmlFor="include-record">{t('table:import.menu.includeRecords')}</Label>
            </div>

            {duplicatePreview.useV2 ? (
              <OperationPreviewPanel
                preview={duplicatePreview.preview.data}
                error={duplicatePreview.preview.error}
                isLoading={
                  duplicatePreview.preview.isPending || duplicatePreview.preview.isFetching
                }
                onRetry={() => void duplicatePreview.preview.refetch()}
              />
            ) : (
              <TableDuplicateConversionWarning fields={duplicatePreview.affectedFields} />
            )}
          </div>
        }
        onCancel={() => setDuplicateSetting(false)}
        onConfirm={async () => {
          if (isLoading || !duplicatePreview.canConfirm) return;
          await duplicateTableFn();
        }}
      />
    </>
  );
};
