/* eslint-disable sonarjs/no-identical-functions */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getUniqName } from '@teable/core';
import { Copy, FileCsv, FileExcel, Pencil, History, Code2, Trash2, Download } from '@teable/icons';
import type { IBaseNodeVo, IDuplicateBaseNodeRo } from '@teable/openapi';
import { BaseNodeResourceType, SUPPORTEDTYPE } from '@teable/openapi';
import { RecordHistory } from '@teable/sdk/components/expand-record/RecordHistory';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBaseId, useBasePermission, useTables } from '@teable/sdk/hooks';
import { ConfirmDialog } from '@teable/ui-lib/base';
import { useConfirm } from '@teable/ui-lib/base/dialog/confirm-modal';
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Input,
  Label,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTrigger,
  Switch,
} from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { FileInputIcon } from 'lucide-react';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useBaseResource } from '@/features/app/hooks/useBaseResource';
import { useSetting } from '@/features/app/hooks/useSetting';
import { tableConfig } from '@/features/i18n/table.config';
import { useDownload } from '../../../hooks/useDownLoad';
import { TableImport } from '../../import-table';
import { useTableHref } from '../../table-list/useTableHref';
import { TableTrash } from '../../trash/components/TableTrash';
import { TableTrashDialog } from '../../trash/components/TableTrashDialog';
import { APIDialog } from '../../view/tool-bar/APIDialog';
import type { TreeItemData } from '../base-node/hooks';
import { findAdjacentNonFolderNode, getNodeUrl, useBaseNodeCrud } from '../base-node/hooks';
import { useBaseNodeContext } from '../base-node/hooks/useBaseNodeContext';

// Menu item component for list variant (mobile)
const ListMenuItem = ({
  icon,
  label,
  onClick,
  destructive,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) => (
  <Button
    variant="ghost"
    className={cn(
      'h-auto w-full justify-start gap-3 rounded-none border-b p-3',
      destructive && 'text-destructive'
    )}
    onClick={onClick}
  >
    {icon}
    <span>{label}</span>
  </Button>
);

interface IBaseNodeMoreProps {
  children?: React.ReactNode;
  resourceType: BaseNodeResourceType;
  resourceId: string;

  className?: string;

  open?: boolean;
  setOpen?: (open: boolean) => void;

  // 'dropdown' for desktop, 'list' for mobile (renders flat list without dropdown wrapper)
  variant?: 'dropdown' | 'list';

  onRename?: () => void;
  onDelete?: (permanent: boolean, confirm?: boolean) => Promise<void>;
  onDuplicate?: (ro?: IDuplicateBaseNodeRo) => Promise<void>;

  // Success callbacks for customizing behavior after operations
  onCreateSuccess?: (node: IBaseNodeVo) => void;
  onDeleteSuccess?: (nodeId: string) => void;
  onDuplicateSuccess?: (node: IBaseNodeVo) => void;
  onUpdateSuccess?: (node: IBaseNodeVo) => void;
}

interface ICommonOperationProps extends IBaseNodeMoreProps {
  children?: React.ReactNode;
  canRename?: boolean;
  canDelete?: boolean;
  canPermanentDelete?: boolean;
  canDuplicate?: boolean;
  nodeTypeLabel?: string; // Node type label (Dashboard/Workflow/App)
}

const CommonOperation = (props: ICommonOperationProps) => {
  const {
    resourceId,
    open,
    setOpen,
    onRename,
    onDuplicate,
    onDelete,
    children,
    variant = 'dropdown',
    canRename = false,
    canDelete = false,
    canPermanentDelete = false,
    canDuplicate = false,
    nodeTypeLabel,
  } = props;
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const { treeItems } = useBaseNodeContext();

  const [duplicateSetting, setDuplicateSetting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Get node name from treeItems
  const nodeName = useMemo(() => {
    const node = Object.values(treeItems).find((n) => n.resourceId === resourceId);
    return node?.resourceMeta?.name;
  }, [treeItems, resourceId]);

  const defaultName = useMemo(
    () => `${nodeName ?? nodeTypeLabel} ${t('space:baseModal.copy')}`,
    [nodeName, nodeTypeLabel, t]
  );

  const { mutateAsync: duplicateFn, isPending } = useMutation({
    mutationFn: async (ro?: IDuplicateBaseNodeRo) => onDuplicate?.(ro),
    onSuccess: () => setDuplicateSetting(false),
  });

  const handleDuplicateClick = useCallback(() => {
    setDuplicateSetting(true);
  }, []);

  const duplicateDialog = duplicateSetting && canDuplicate && (
    <ConfirmDialog
      open={duplicateSetting}
      onOpenChange={setDuplicateSetting}
      title={`${t('common:actions.duplicate')} ${nodeName ?? nodeTypeLabel}`}
      cancelText={t('common:actions.cancel')}
      confirmText={t('common:actions.duplicate')}
      confirmLoading={isPending}
      content={
        <div className="flex flex-col space-y-2 text-sm">
          <div className="flex flex-col gap-2">
            <Label>
              {nodeTypeLabel} {t('common:name')}
            </Label>
            <Input ref={inputRef} defaultValue={defaultName} />
          </div>
        </div>
      }
      onCancel={() => setDuplicateSetting(false)}
      onConfirm={async () => {
        const name = inputRef.current?.value?.trim();
        if (!name) {
          toast.error(t('common:name') + ' ' + t('common:required'));
          return;
        }
        await duplicateFn({ name });
      }}
    />
  );

  if (!canRename && !canDelete && !canPermanentDelete && !canDuplicate) {
    return null;
  }

  // List variant for mobile - renders flat list
  if (variant === 'list') {
    return (
      <>
        {canRename && (
          <ListMenuItem
            icon={<Pencil className="size-4" />}
            label={t('table:table.rename')}
            onClick={() => onRename?.()}
          />
        )}
        {canDuplicate && (
          <ListMenuItem
            icon={<Copy className="size-4" />}
            label={t('table:import.menu.duplicate')}
            onClick={handleDuplicateClick}
          />
        )}
        {canPermanentDelete && (
          <ListMenuItem
            icon={<Trash2 className="size-4" />}
            label={t('common:actions.permanentDelete')}
            onClick={() => onDelete?.(true)}
            destructive
          />
        )}
        {canDelete && (
          <ListMenuItem
            icon={<Trash2 className="size-4" />}
            label={t('common:actions.delete')}
            onClick={() => onDelete?.(false)}
          />
        )}
        {duplicateDialog}
      </>
    );
  }

  // Dropdown variant for desktop
  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="min-w-[160px]"
          onClick={(e) => e.stopPropagation()}
        >
          {canRename && (
            <DropdownMenuItem onClick={() => onRename?.()}>
              <Pencil className="mr-2" />
              {t('table:table.rename')}
            </DropdownMenuItem>
          )}
          {canDuplicate && (
            <DropdownMenuItem onClick={handleDuplicateClick}>
              <Copy className="mr-2" />
              {t('table:import.menu.duplicate')}
            </DropdownMenuItem>
          )}
          {canPermanentDelete && (
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => onDelete?.(true)}
            >
              <Trash2 className="mr-2" />
              {t('common:actions.permanentDelete')}
            </DropdownMenuItem>
          )}
          {canDelete && (
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => onDelete?.(false)}
            >
              <Trash2 className="mr-2" />
              {t('common:actions.delete')}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {duplicateDialog}
    </>
  );
};

export const DashboardOperation = (props: IBaseNodeMoreProps) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const permission = useBasePermission();
  const { disallowDashboard } = useSetting();
  const canRename = Boolean(permission?.['base|update']);
  const canDelete = false;
  const canPermanentDelete = Boolean(permission?.['base|delete']);
  const canDuplicate = Boolean(permission?.['base|update'] && !disallowDashboard);

  return (
    <CommonOperation
      {...props}
      nodeTypeLabel={t('common:noun.dashboard')}
      canRename={canRename}
      canDelete={canDelete}
      canPermanentDelete={canPermanentDelete}
      canDuplicate={canDuplicate}
    />
  );
};

export const WorkflowOperation = (props: IBaseNodeMoreProps) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const permission = useBasePermission();
  const canRename = Boolean(permission?.['automation|update']);
  const canDelete = Boolean(permission?.['automation|delete']);
  const canPermanentDelete = false;
  const canDuplicate = Boolean(permission?.['automation|create']);

  return (
    <CommonOperation
      {...props}
      nodeTypeLabel={t('common:noun.automation')}
      canRename={canRename}
      canDelete={canDelete}
      canPermanentDelete={canPermanentDelete}
      canDuplicate={canDuplicate}
    />
  );
};

export const AppOperation = (props: IBaseNodeMoreProps) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const permission = useBasePermission();

  const canRename = Boolean(permission?.['app|update']);
  const canDelete = Boolean(permission?.['app|delete']);
  const canPermanentDelete = false;
  const canDuplicate = Boolean(permission?.['app|create']);

  return (
    <CommonOperation
      {...props}
      nodeTypeLabel={t('common:noun.app')}
      canRename={canRename}
      canDelete={canDelete}
      canPermanentDelete={canPermanentDelete}
      canDuplicate={canDuplicate}
    />
  );
};

export const FolderOperation = (props: IBaseNodeMoreProps) => {
  const { resourceId } = props;
  const { treeItems } = useBaseNodeContext();
  const node = useMemo(
    () => Object.values(treeItems).find((n) => n.resourceId === resourceId),
    [treeItems, resourceId]
  );
  const permission = useBasePermission();
  const canRename = Boolean(permission?.['base|update']);
  const canDelete = false;
  const canPermanentDelete = !node?.children?.length && Boolean(permission?.['base|update']);
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
  const {
    resourceId,
    open,
    setOpen,
    onRename,
    children,
    onDelete,
    onDuplicate,
    variant = 'dropdown',
  } = props;

  const baseId = useBaseId() as string;
  const tables = useTables();
  const queryClient = useQueryClient();
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const basePermission = useBasePermission();
  const canTableRecordHistoryRead = basePermission?.['table_record_history|read'];
  const canTableTrashRead = basePermission?.['table|trash_read'];

  const router = useRouter();
  const [apiDialogOpen, setApiDialogOpen] = useState(false);
  const [tableHistoryDialogOpen, setTableHistoryDialogOpen] = useState(false);
  const [tableTrashDialogOpen, setTableTrashDialogOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [importVisible, setImportVisible] = useState(false);
  const [duplicateSetting, setDuplicateSetting] = useState(false);
  const [importType, setImportType] = useState(SUPPORTEDTYPE.CSV);
  const inputRef = useRef<HTMLInputElement>(null);
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
    includeRecords: true,
  });

  const menuPermission = useMemo(() => {
    return {
      deleteTable: table?.permission?.['table|delete'],
      updateTable: table?.permission?.['table|update'],
      duplicateTable: table?.permission?.['table|read'] && basePermission?.['table|create'],
      exportTable: table?.permission?.['table|export'],
      importTable: table?.permission?.['table|import'],
      tableRecordHistory: canTableRecordHistoryRead,
      tableTrash: canTableTrashRead,
    };
  }, [basePermission, table?.permission, canTableRecordHistoryRead, canTableTrashRead]);

  const deleteTable = async (permanent: boolean) => {
    if (!resourceId) return;
    await onDelete?.(permanent, false);
    setDeleteConfirm(false);
    queryClient.invalidateQueries({ queryKey: ReactQueryKeys.getTrashItems(baseId as string) });
  };

  const { mutateAsync: duplicateTableFn, isPending: isLoading } = useMutation({
    mutationFn: async (ro?: IDuplicateBaseNodeRo) => onDuplicate?.(ro),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.tableList(baseId as string),
      });
      setDuplicateSetting(false);
    },
  });

  const onRecordClick = (recordId: string) => {
    router.push(
      {
        pathname: router.pathname,
        query: { ...router.query, recordId },
      },
      undefined,
      {
        shallow: true,
      }
    );
  };

  if (!table) {
    return null;
  }

  if (!Object.values(menuPermission).some(Boolean)) {
    return null;
  }

  // Dialogs - shared between both variants
  const dialogs = (
    <>
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
                <Input ref={inputRef} defaultValue={defaultTableName} />
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
              name: inputRef.current?.value?.trim() || defaultTableName,
              includeRecords: duplicateOption.includeRecords,
            });
          }}
        />
      )}

      {menuPermission.tableRecordHistory && (
        <Dialog open={tableHistoryDialogOpen} onOpenChange={setTableHistoryDialogOpen}>
          <DialogContent className="flex h-[90%] max-w-4xl flex-col gap-0 p-0">
            <DialogHeader className="border-b p-4">
              <DialogTitle>{t('table:table.tableRecordHistory')}</DialogTitle>
            </DialogHeader>
            <RecordHistory tableId={resourceId} onRecordClick={onRecordClick} />
          </DialogContent>
        </Dialog>
      )}

      {menuPermission.tableTrash && (
        <TableTrashDialog
          open={tableTrashDialogOpen}
          onOpenChange={setTableTrashDialogOpen}
          tableId={resourceId}
        />
      )}

      {apiDialogOpen && (
        <APIDialog open={apiDialogOpen} setOpen={setApiDialogOpen}>
          <span className="hidden text-sm">API</span>
        </APIDialog>
      )}
    </>
  );

  // List variant for mobile - renders flat list without dropdown wrapper
  if (variant === 'list') {
    return (
      <>
        {menuPermission.duplicateTable && (
          <ListMenuItem
            icon={<Copy className="size-4" />}
            label={t('table:import.menu.duplicate')}
            onClick={() => setDuplicateSetting(true)}
          />
        )}
        {menuPermission.exportTable && (
          <ListMenuItem
            icon={<Download className="size-4" />}
            label={t('table:import.menu.downAsCsv')}
            onClick={() => trigger?.()}
          />
        )}
        {menuPermission.importTable && (
          <>
            <ListMenuItem
              icon={<FileCsv className="size-4" />}
              label={t('table:import.menu.importCsvData')}
              onClick={() => {
                setImportVisible(true);
                setImportType(SUPPORTEDTYPE.CSV);
              }}
            />
            <ListMenuItem
              icon={<FileExcel className="size-4" />}
              label={t('table:import.menu.importExcelData')}
              onClick={() => {
                setImportVisible(true);
                setImportType(SUPPORTEDTYPE.EXCEL);
              }}
            />
          </>
        )}
        <ListMenuItem
          icon={<Code2 className="size-4" />}
          label="API"
          onClick={() => setApiDialogOpen(true)}
        />
        {menuPermission.tableRecordHistory && (
          <Sheet modal={true}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                className="h-auto w-full justify-start gap-3 rounded-none border-b p-3"
              >
                <History className="size-4" />
                <span>{t('table:table.tableRecordHistory')}</span>
              </Button>
            </SheetTrigger>
            <SheetContent
              className="h-5/6 overflow-hidden rounded-t-lg p-0"
              side="bottom"
              closeable={false}
            >
              <SheetHeader className="h-16 justify-center border-b text-2xl">
                {t('table:table.tableRecordHistory')}
              </SheetHeader>
              <RecordHistory tableId={resourceId} onRecordClick={onRecordClick} />
            </SheetContent>
          </Sheet>
        )}
        {menuPermission.tableTrash && (
          <Sheet modal={true}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                className="h-auto w-full justify-start gap-3 rounded-none border-b p-3"
              >
                <Trash2 className="size-4" />
                <span>{t('table:tableTrash.title')}</span>
              </Button>
            </SheetTrigger>
            <SheetContent
              className="h-5/6 overflow-hidden rounded-t-lg p-0"
              side="bottom"
              closeable={false}
            >
              <SheetHeader className="h-16 justify-center border-b text-2xl">
                {t('table:tableTrash.title')}
              </SheetHeader>
              <TableTrash tableId={resourceId} />
            </SheetContent>
          </Sheet>
        )}
        {menuPermission.deleteTable && (
          <ListMenuItem
            icon={<Trash2 className="size-4" />}
            label={t('common:actions.delete')}
            onClick={() => setDeleteConfirm(true)}
            destructive
          />
        )}
        {dialogs}
      </>
    );
  }

  // Dropdown variant for desktop
  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="min-w-[160px]"
          onClick={(e) => e.stopPropagation()}
        >
          {menuPermission.updateTable && (
            <DropdownMenuItem onClick={() => onRename?.()}>
              <Pencil className="mr-2 size-4" />
              {t('table:table.rename')}
            </DropdownMenuItem>
          )}
          {menuPermission.duplicateTable && (
            <DropdownMenuItem onClick={() => setDuplicateSetting(true)}>
              <Copy className="mr-2 size-4" />
              {t('table:import.menu.duplicate')}
            </DropdownMenuItem>
          )}
          {(menuPermission.updateTable || menuPermission.duplicateTable) &&
            menuPermission.exportTable && <DropdownMenuSeparator />}

          {menuPermission.exportTable && (
            <DropdownMenuItem onClick={() => trigger?.()}>
              <Download className="mr-2 size-4" />
              {t('table:import.menu.downAsCsv')}
            </DropdownMenuItem>
          )}
          {menuPermission.importTable && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <FileInputIcon className="mr-2 size-4" />
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

          <DropdownMenuItem onClick={() => setApiDialogOpen(true)}>
            <Code2 className="mr-2 size-4" />
            API
          </DropdownMenuItem>

          {(menuPermission.tableRecordHistory || menuPermission.tableTrash) && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <History className="mr-2 size-4" />
                <span>{t('sdk:noun.history')}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  {menuPermission.tableRecordHistory && (
                    <DropdownMenuItem
                      onClick={() => {
                        setTableHistoryDialogOpen(true);
                      }}
                    >
                      <History className="mr-1 size-4" />
                      {t('table:table.tableRecordHistory')}
                    </DropdownMenuItem>
                  )}
                  {menuPermission.tableTrash && (
                    <DropdownMenuItem
                      onClick={() => {
                        setTableTrashDialogOpen(true);
                      }}
                    >
                      <Trash2 className="mr-1 size-4" />
                      {t('table:tableTrash.title')}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          )}

          {menuPermission.deleteTable && (
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => setDeleteConfirm(true)}
            >
              <Trash2 className="mr-2 size-4" />
              {t('common:actions.delete')}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {dialogs}
    </>
  );
};

const getNode = (treeItems: Record<string, TreeItemData>, resourceId: string) => {
  return Object.values(treeItems).find((node) => node.resourceId === resourceId);
};

export const BaseNodeMore = (props: IBaseNodeMoreProps) => {
  const {
    resourceType,
    resourceId,
    children,
    onDelete,
    onDuplicate,
    onCreateSuccess: onCreateSuccessProp,
    onDeleteSuccess: onDeleteSuccessProp,
    onDuplicateSuccess: onDuplicateSuccessProp,
    onUpdateSuccess: onUpdateSuccessProp,
    ...rest
  } = props;
  const { confirm: comfirmModal } = useConfirm();
  const { t } = useTranslation('common');
  const router = useRouter();
  const { treeItems } = useBaseNodeContext();
  const { hrefMap: tableHrefMap, viewIdMap: tableViewIdsMap } = useTableHref();
  const queryClient = useQueryClient();
  const baseResource = useBaseResource();

  const currentResourceId = useMemo(() => {
    switch (baseResource.resourceType) {
      case BaseNodeResourceType.Table:
        return baseResource.tableId;
      case BaseNodeResourceType.Dashboard:
        return baseResource.dashboardId;
      case BaseNodeResourceType.Workflow:
        return baseResource.workflowId;
      case BaseNodeResourceType.App:
        return baseResource.appId;
      default:
        return undefined;
    }
  }, [baseResource]);
  const { baseId } = baseResource;

  const createSuccefulyCallback = useCallback(
    (node: IBaseNodeVo) => {
      const { resourceType, resourceId, resourceMeta } = node;
      const viewId =
        resourceType === BaseNodeResourceType.Table ? resourceMeta?.defaultViewId : undefined;

      const url = getNodeUrl({
        baseId,
        resourceType,
        resourceId,
        viewId,
      });
      if (url) {
        if (resourceType === BaseNodeResourceType.Table) {
          router.push(url, undefined, { shallow: Boolean(viewId) });
        } else {
          router.push(url, undefined, { shallow: true });
        }
      }
    },
    [baseId, router]
  );

  const duplicateSuccessCallback = useCallback(
    (node: IBaseNodeVo) => {
      const { resourceType, resourceId, resourceMeta } = node;
      const viewId =
        resourceType === BaseNodeResourceType.Table ? resourceMeta?.defaultViewId : undefined;
      const url = getNodeUrl({
        baseId,
        resourceType,
        resourceId,
        viewId,
      });
      if (url) {
        if (resourceType === BaseNodeResourceType.Table) {
          router.push(url, undefined, { shallow: Boolean(viewId) });
        } else {
          router.push(url, undefined, { shallow: true });
        }
      }
    },
    [baseId, router]
  );

  const deleteSuccessCallback = useCallback(
    (nodeId: string) => {
      if (resourceId !== currentResourceId) {
        return;
      }

      const adjacentNode = findAdjacentNonFolderNode(treeItems, nodeId);
      if (!adjacentNode) {
        router.push(`/base/${baseId}`, undefined, { shallow: true });
        return;
      }

      const { resourceType: adjResourceType, resourceId: adjResourceId } = adjacentNode;
      if (adjResourceType === BaseNodeResourceType.Table) {
        const viewId = tableViewIdsMap[adjResourceId];
        const url = tableHrefMap[adjResourceId];
        if (url) {
          router.push({ pathname: url }, undefined, {
            shallow: Boolean(viewId),
          });
          return;
        }
      }

      const url = getNodeUrl({
        baseId,
        resourceType: adjResourceType,
        resourceId: adjResourceId,
      });
      if (url) {
        router.push(url, undefined, { shallow: true });
      }
    },
    [resourceId, currentResourceId, treeItems, baseId, router, tableHrefMap, tableViewIdsMap]
  );

  const updateSuccefulyCallback = useCallback(
    (node: IBaseNodeVo) => {
      const { resourceType, resourceId } = node;
      switch (resourceType) {
        case BaseNodeResourceType.Dashboard:
          queryClient.invalidateQueries({ queryKey: ReactQueryKeys.getDashboard(resourceId) });
          break;
        case BaseNodeResourceType.Workflow:
          queryClient.invalidateQueries({
            queryKey: ReactQueryKeys.workflowItem(baseId, resourceId),
          });
          break;
        case BaseNodeResourceType.App:
          queryClient.invalidateQueries({ queryKey: ReactQueryKeys.getApp(baseId, resourceId) });
          break;
      }
    },
    [baseId, queryClient]
  );

  const curdHooks = useBaseNodeCrud({
    onDuplicateSuccess: onDuplicateSuccessProp ?? duplicateSuccessCallback,
    onDeleteSuccess: onDeleteSuccessProp ?? deleteSuccessCallback,
    onCreateSuccess: onCreateSuccessProp ?? createSuccefulyCallback,
    onUpdateSuccess: onUpdateSuccessProp ?? updateSuccefulyCallback,
  });

  const mergedProps: IBaseNodeMoreProps = {
    ...rest,
    resourceType,
    resourceId,
    onDelete:
      onDelete ??
      (async (permanent: boolean, confirm: boolean = true) => {
        const node = getNode(treeItems, resourceId);
        if (!node) return;
        const nodeName = node.resourceMeta?.name;
        const titleMap = {
          [BaseNodeResourceType.Folder]: t('noun.folder'),
          [BaseNodeResourceType.Table]: t('noun.table'),
          [BaseNodeResourceType.Dashboard]: t('noun.dashboard'),
          [BaseNodeResourceType.Workflow]: t('noun.automation'),
          [BaseNodeResourceType.App]: t('noun.app'),
        };
        const result = !confirm
          ? true
          : await comfirmModal({
              title: `${t('actions.delete')} ${titleMap[resourceType]?.toLowerCase()}`,
              description: t('actions.deleteTip', {
                name: nodeName,
              }),
              confirmText: permanent ? t('actions.delete') : t('trash.addToTrash'),
              cancelText: t('actions.cancel'),
              confirmButtonVariant: permanent ? 'destructive' : 'default',
            });
        if (result) {
          await curdHooks.deleteNode(node.id, permanent);
        }
      }),
    onDuplicate:
      onDuplicate ??
      (async (ro) => {
        const node = getNode(treeItems, resourceId);
        if (!node) return;
        await curdHooks.duplicateNode(node.id, ro ?? {});
      }),
  };

  switch (resourceType) {
    case BaseNodeResourceType.Table:
      return <TableOperation {...mergedProps}>{children}</TableOperation>;
    case BaseNodeResourceType.Dashboard:
      return <DashboardOperation {...mergedProps}>{children}</DashboardOperation>;
    case BaseNodeResourceType.Workflow:
      return <WorkflowOperation {...mergedProps}>{children}</WorkflowOperation>;
    case BaseNodeResourceType.App:
      return <AppOperation {...mergedProps}>{children}</AppOperation>;
    case BaseNodeResourceType.Folder:
      return <FolderOperation {...mergedProps}>{children}</FolderOperation>;
    default:
      return null;
  }
};
