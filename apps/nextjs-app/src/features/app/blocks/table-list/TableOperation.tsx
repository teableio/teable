import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getUniqName } from '@teable/core';
import { MoreHorizontal, Settings, Export, Import, FileCsv, FileExcel } from '@teable/icons';
import { duplicateTable, duplicateTableCheck, SUPPORTEDTYPE } from '@teable/openapi';
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
  DialogFooter,
  Button,
} from '@teable/ui-lib/shadcn';
import { CopyPlus, Pen, Trash } from 'lucide-react';
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

    if (!tableId) return;

    await base.deleteTable(tableId, permanent);
    setDeleteConfirm(false);

    queryClient.invalidateQueries({ queryKey: ReactQueryKeys.getTrashItems(baseId as string) });

    const firstTableId = tables.find((t) => t.id !== tableId)?.id;
    if (routerTableId === tableId) {
      router.push(firstTableId ? `/base/${baseId}/table/${firstTableId}` : `/base/${baseId}`);
    }
  };

  // Cross-space preview resolved BEFORE opening the duplicate dialog (see
  // handleDuplicateClick below) so the warning is rendered with the dialog's
  // initial frame rather than appearing late.
  const [affectedCrossSpace, setAffectedCrossSpace] = useState<Array<{
    fieldId: string;
    fieldName: string;
  }> | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);

  const handleDuplicateClick = async () => {
    if (!baseId) {
      setDuplicateSetting(true);
      return;
    }
    setIsPreviewing(true);
    try {
      const res = await duplicateTableCheck(baseId as string, table.id);
      const affected = res.data.affectedFields;
      setAffectedCrossSpace(affected && affected.length > 0 ? affected : null);
    } catch {
      setAffectedCrossSpace(null);
    }
    setIsPreviewing(false);
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
              <Pen className="mr-2 size-4" />
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
              <Settings className="mr-2 size-4" />
              {t('common:noun.design')}
            </Link>
          </DropdownMenuItem>
          {menuPermission.duplicateTable && (
            <DropdownMenuItem
              disabled={isPreviewing}
              onClick={(e) => {
                e.preventDefault();
                void handleDuplicateClick();
              }}
            >
              <CopyPlus className="mr-2 size-4" />
              {t('table:import.menu.duplicate')}
            </DropdownMenuItem>
          )}
          {menuPermission.exportTable && (
            <DropdownMenuItem
              onClick={() => {
                trigger?.();
              }}
            >
              <Export className="mr-2 size-4" />
              {t('table:import.menu.downAsCsv')}
            </DropdownMenuItem>
          )}
          {menuPermission.importTable && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Import className="mr-2 size-4" />
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
              <Trash className="mr-2 size-4" />
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
        content={
          <>
            <div className="space-y-2 text-sm">
              <p>{t('table:table.deleteTip1')}</p>
              <p>{t('common:trash.description')}</p>
            </div>
            <DialogFooter>
              <Button size={'sm'} variant={'ghost'} onClick={() => setDeleteConfirm(false)}>
                {t('common:actions.cancel')}
              </Button>
              <Button size={'sm'} onClick={() => deleteTable()}>
                {t('common:trash.addToTrash')}
              </Button>
            </DialogFooter>
          </>
        }
      />

      <ConfirmDialog
        open={duplicateSetting}
        onOpenChange={(open) => {
          setDuplicateSetting(open);
          if (!open) setAffectedCrossSpace(null);
        }}
        title={`${t('common:actions.duplicate')} ${table?.name}`}
        cancelText={t('common:actions.cancel')}
        confirmText={
          affectedCrossSpace
            ? t('table:crossSpace.convertAndDuplicate')
            : t('common:actions.duplicate')
        }
        confirmLoading={isLoading}
        content={
          <div className="flex flex-col space-y-2 text-sm">
            <div className="flex flex-col gap-2">
              <Label>
                {t('common:noun.table')} {t('common:name')}
              </Label>
              <Input
                defaultValue={defaultTableName}
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

            {affectedCrossSpace && (
              <div className="mt-2 rounded-md border border-yellow-300 bg-yellow-50 p-2.5 text-xs text-yellow-900 dark:border-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-200">
                <p className="font-medium">{t('table:crossSpace.duplicateTableTitle')}</p>
                <p className="mt-1">
                  {t('table:crossSpace.duplicateTableDescription', {
                    count: affectedCrossSpace.length,
                  })}
                </p>
                <div className="mt-2 flex max-h-40 flex-wrap gap-1 overflow-y-auto">
                  {affectedCrossSpace.map((f) => (
                    <span
                      key={f.fieldId}
                      className="inline-flex items-center rounded border border-yellow-300/60 bg-background/70 px-1.5 py-0.5 text-[11px] dark:border-yellow-700/60 dark:bg-yellow-950/40"
                    >
                      {f.fieldName}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        }
        onCancel={() => setDuplicateSetting(false)}
        onConfirm={async () => {
          duplicateTableFn();
        }}
      />
    </>
  );
};
