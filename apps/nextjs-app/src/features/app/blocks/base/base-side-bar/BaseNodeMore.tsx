/* eslint-disable sonarjs/no-identical-functions */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getUniqName } from '@teable/core';
import {
  Copy,
  Export,
  FileCsv,
  FileExcel,
  Import,
  MoreHorizontal,
  Pencil,
  Settings,
  Trash2,
} from '@teable/icons';
import type { IDuplicateBaseNodeRo } from '@teable/openapi';
import { BaseNodeResourceType, SUPPORTEDTYPE } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBaseId, useBasePermission, useTables } from '@teable/sdk/hooks';
import { ConfirmDialog } from '@teable/ui-lib/base';
import {
  Button,
  DialogFooter,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Input,
  Label,
  Switch,
} from '@teable/ui-lib/shadcn';
import Link from 'next/link';
import { useTranslation } from 'next-i18next';
import { useMemo, useState } from 'react';
import { useSetting } from '@/features/app/hooks/useSetting';
import { tableConfig } from '@/features/i18n/table.config';
import { useDownload } from '../../../hooks/useDownLoad';
import { TableImport } from '../../import-table';

interface IBaseNodeMoreProps {
  resourceType: BaseNodeResourceType;
  resourceId: string;

  className?: string;

  open?: boolean;
  setOpen?: (open: boolean) => void;

  onRename?: () => void;
  onDelete?: (permanent: boolean, confirm?: boolean) => Promise<void>;
  onDuplicate?: (ro?: IDuplicateBaseNodeRo) => Promise<void>;
}

interface ICommonOperationProps extends IBaseNodeMoreProps {
  children?: React.ReactNode;
  canRename?: boolean;
  canDelete?: boolean;
  canPermanentDelete?: boolean;
  canDuplicate?: boolean;
}

const CommonOperation = (props: ICommonOperationProps) => {
  const {
    open,
    setOpen,
    onRename,
    onDuplicate,
    onDelete,
    children,
    canRename = true,
    canDelete = true,
    canPermanentDelete = true,
    canDuplicate = true,
    className,
  } = props;
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  if (!canRename && !canDelete && !canDuplicate && !children) {
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
          align="start"
          className="min-w-[160px]"
          onClick={(e) => e.stopPropagation()}
        >
          {canRename && (
            <DropdownMenuItem onClick={() => onRename?.()}>
              <Pencil className="mr-2" />
              {t('table:table.rename')}
            </DropdownMenuItem>
          )}
          {children}
          {canDuplicate && (
            <DropdownMenuItem onClick={() => onDuplicate?.()}>
              <Copy className="mr-2" />
              {t('table:import.menu.duplicate')}
            </DropdownMenuItem>
          )}
          {canPermanentDelete && (
            <DropdownMenuItem className="text-destructive" onClick={() => onDelete?.(true)}>
              <Trash2 className="mr-2" />
              {t('common:actions.permanentDelete')}
            </DropdownMenuItem>
          )}
          {canDelete && (
            <DropdownMenuItem className="text-destructive" onClick={() => onDelete?.(false)}>
              <Trash2 className="mr-2" />
              {t('common:actions.delete')}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
};

export const DashboardOperation = (props: IBaseNodeMoreProps) => {
  const permission = useBasePermission();
  const { disallowDashboard } = useSetting();
  const canRename = Boolean(permission?.['base|update']);
  const canDelete = false;
  const canPermanentDelete = Boolean(permission?.['base|delete']);
  const canDuplicate = Boolean(permission?.['base|update'] && !disallowDashboard);

  return (
    <CommonOperation
      {...props}
      canRename={canRename}
      canDelete={canDelete}
      canPermanentDelete={canPermanentDelete}
      canDuplicate={canDuplicate}
    />
  );
};

export const WorkflowOperation = (props: IBaseNodeMoreProps) => {
  const permission = useBasePermission();
  const canRename = Boolean(permission?.['automation|update']);
  const canDelete = false;
  const canPermanentDelete = Boolean(permission?.['automation|delete']);
  const canDuplicate = Boolean(permission?.['automation|create']);

  return (
    <CommonOperation
      {...props}
      canRename={canRename}
      canDelete={canDelete}
      canPermanentDelete={canPermanentDelete}
      canDuplicate={canDuplicate}
    />
  );
};

export const AppOperation = (props: IBaseNodeMoreProps) => {
  const permission = useBasePermission();
  const canRename = Boolean(permission?.['base|update']);
  const canDelete = false;
  const canPermanentDelete = Boolean(permission?.['base|delete']);
  const canDuplicate = false;

  return (
    <CommonOperation
      {...props}
      canRename={canRename}
      canDelete={canDelete}
      canPermanentDelete={canPermanentDelete}
      canDuplicate={canDuplicate}
    />
  );
};

export const FolderOperation = (props: IBaseNodeMoreProps) => {
  const permission = useBasePermission();
  const canRename = Boolean(permission?.['base|update']);
  const canDelete = false;
  const canPermanentDelete = Boolean(permission?.['base|delete']);
  const canDuplicate = false;

  return (
    <CommonOperation
      {...props}
      canRename={canRename}
      canDelete={canDelete}
      canPermanentDelete={canPermanentDelete}
      canDuplicate={canDuplicate}
    />
  );
};

export const TableOperation = (props: IBaseNodeMoreProps) => {
  const { resourceId, open, setOpen, onRename, className, onDelete, onDuplicate } = props;
  const baseId = useBaseId() as string;
  const tables = useTables();
  const queryClient = useQueryClient();
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const permission = useBasePermission();

  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [importVisible, setImportVisible] = useState(false);
  const [duplicateSetting, setDuplicateSetting] = useState(false);
  const [importType, setImportType] = useState(SUPPORTEDTYPE.CSV);

  const table = useMemo(() => tables.find((t) => t.id === resourceId), [tables, resourceId]);
  const { trigger } = useDownload({ downloadUrl: `/api/export/${resourceId}`, key: 'table' });

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
      deleteTable: table?.permission?.['table|delete'],
      updateTable: table?.permission?.['table|update'],
      duplicateTable: table?.permission?.['table|read'] && permission?.['table|create'],
      exportTable: table?.permission?.['table|export'],
      importTable: table?.permission?.['table|import'],
    };
  }, [permission, table?.permission]);

  const deleteTable = async (permanent: boolean) => {
    if (!resourceId) return;
    await onDelete?.(permanent, false);
    setDeleteConfirm(false);
    queryClient.invalidateQueries(ReactQueryKeys.getTrashItems(baseId as string));
  };

  const { mutateAsync: duplicateTableFn, isLoading } = useMutation({
    mutationFn: async (ro?: IDuplicateBaseNodeRo) => onDuplicate?.(ro),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.tableList(baseId as string),
      });
      setDuplicateSetting(false);
    },
  });

  if (!table) {
    return null;
  }

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
          align="start"
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
                query: { baseId, tableId: resourceId },
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
            <DropdownMenuItem onClick={() => trigger?.()}>
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
          tableId={resourceId}
          fileType={importType}
          onOpenChange={(visible: boolean) => setImportVisible(visible)}
        />
      )}

      {deleteConfirm && (
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
                <Button size={'sm'} onClick={() => deleteTable(false)}>
                  {t('common:trash.addToTrash')}
                </Button>
              </DialogFooter>
            </>
          }
        />
      )}

      {duplicateSetting && (
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
            await duplicateTableFn({
              name: duplicateOption.name,
              includeRecords: duplicateOption.includeRecords,
            });
          }}
        />
      )}
    </>
  );
};

export const BaseNodeMore = (props: IBaseNodeMoreProps) => {
  const { resourceType } = props;

  switch (resourceType) {
    case BaseNodeResourceType.Table:
      return <TableOperation {...props} />;
    case BaseNodeResourceType.Dashboard:
      return <DashboardOperation {...props} />;
    case BaseNodeResourceType.Workflow:
      return <WorkflowOperation {...props} />;
    case BaseNodeResourceType.App:
      return <AppOperation {...props} />;
    case BaseNodeResourceType.Folder:
      return <FolderOperation {...props} />;
    default:
      return null;
  }
};
