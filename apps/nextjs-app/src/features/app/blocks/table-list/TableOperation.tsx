import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getUniqName } from '@teable/core';
import {
  MoreHorizontal,
  Pencil,
  Settings,
  Trash2,
  Export,
  Import,
  FileCsv,
  FileExcel,
  Copy,
} from '@teable/icons';
import { duplicateTable, PinType, SUPPORTEDTYPE } from '@teable/openapi';
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
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import React, { useMemo, useState } from 'react';
import { tableConfig } from '@/features/i18n/table.config';
import { useDownload } from '../../hooks/useDownLoad';
import { TableImport } from '../import-table';
import { StarButton } from '../space/space-side-bar/StarButton';

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

  const { mutateAsync: duplicateTableFn, isLoading } = useMutation({
    mutationFn: () => duplicateTable(baseId as string, table.id, duplicateOption),
    onSuccess: (data) => {
      const {
        data: { id },
      } = data;
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.tableList(baseId as string),
      });
      setDuplicateSetting(false);
      router.push({
        pathname: '/base/[baseId]/[tableId]',
        query: { baseId, tableId: id },
      });
    },
  });

  if (!Object.values(menuPermission).some(Boolean)) {
    return null;
  }

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div className="flex items-center gap-1" onMouseDown={(e) => e.stopPropagation()}>
      <StarButton id={table.id} type={PinType.Table} className="size-3.5" />
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
                pathname: '/base/[baseId]/design',
                query: { baseId, tableId: table.id },
              }}
              title={t('common:noun.design')}
            >
              <Settings className="mr-2" />
              {t('common:noun.design')}
            </Link>
          </DropdownMenuItem>
          {menuPermission.duplicateTable && (
            <DropdownMenuItem onClick={() => setDuplicateSetting(true)}>
              <Copy className="mr-2" />
              {t('table:import.menu.duplicate')}
            </DropdownMenuItem>
          )}
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
              <Button variant="destructive" size={'sm'} onClick={() => deleteTable(true)}>
                {t('common:actions.permanentDelete')}
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
        onOpenChange={setDuplicateSetting}
        title={`${t('common:actions.duplicate')} ${table?.name}`}
        cancelText={t('common:actions.cancel')}
        confirmText={t('common:actions.duplicate')}
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
          </div>
        }
        onCancel={() => setDuplicateSetting(false)}
        onConfirm={async () => {
          duplicateTableFn();
        }}
      />
    </div>
  );
};
