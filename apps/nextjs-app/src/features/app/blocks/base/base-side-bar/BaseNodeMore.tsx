/* eslint-disable sonarjs/no-identical-functions */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getUniqName } from '@teable/core';
import { FileCsv, FileExcel, History, Code2, Download, Share2 } from '@teable/icons';
import type {
  IBaseNodeVo,
  IBaseNodeTableResourceMeta,
  IDuplicateBaseNodeRo,
} from '@teable/openapi';
import { BaseNodeResourceType, duplicateTableCheck, SUPPORTEDTYPE } from '@teable/openapi';
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
import {
  AppWindowMacIcon,
  CopyPlus,
  FileInputIcon,
  Info,
  Pen,
  ShieldCheck,
  Trash,
} from 'lucide-react';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import type { ReactNode } from 'react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useBaseResource } from '@/features/app/hooks/useBaseResource';
import { useSetting } from '@/features/app/hooks/useSetting';
import { tableConfig } from '@/features/i18n/table.config';
import { LoginAppWarning } from '../../../components/LoginAppWarning';
import { useDownload } from '../../../hooks/useDownLoad';
import { TableImport } from '../../import-table';
import { useTableHref } from '../../table-list/useTableHref';
import { TableTrash } from '../../trash/components/TableTrash';
import { TableTrashDialog } from '../../trash/components/TableTrashDialog';
import { APIDialog } from '../../view/tool-bar/APIDialog';
import type { TreeItemData } from '../base-node/hooks';
import { findAdjacentNonFolderNode, getNodeUrl, useBaseNodeCrud } from '../base-node/hooks';
import { useBaseNodeContext } from '../base-node/hooks/useBaseNodeContext';
import { BaseNodeInfoDialog } from './BaseNodeInfoDialog';
import { getTableOperationMenuPermission } from './BaseNodeMore.utils';
import { NodeShareDialog } from './NodeShareDialog';

const useNode = (resourceId: string) => {
  const { treeItems } = useBaseNodeContext();
  return useMemo(
    () => Object.values(treeItems).find((item) => item.resourceId === resourceId),
    [treeItems, resourceId]
  );
};

// Menu item component for list variant (mobile)
const ListMenuItem = ({
  icon,
  label,
  onClick,
  destructive,
}: {
  icon: ReactNode;
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
  children?: ReactNode;
  resourceType: BaseNodeResourceType;
  resourceId: string;

  className?: string;

  open?: boolean;
  setOpen?: (open: boolean) => void;

  // 'dropdown' for desktop, 'list' for mobile (renders flat list without dropdown wrapper)
  variant?: 'dropdown' | 'list';

  contentAlign?: 'start' | 'end';

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
  children?: ReactNode;
  canRename?: boolean;
  canDelete?: boolean;
  canPermanentDelete?: boolean;
  canDuplicate?: boolean;
  canShare?: boolean;
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
    contentAlign = 'end',
    canRename = false,
    canDelete = false,
    canPermanentDelete = false,
    canDuplicate = false,
    canShare = false,
    nodeTypeLabel,
  } = props;
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  const [duplicateSetting, setDuplicateSetting] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [nodeInfoDialogOpen, setNodeInfoDialogOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const node = useNode(resourceId);
  const nodeName = node?.resourceMeta?.name;
  const shareNodeId = canShare && node ? node.id : undefined;

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

  if (!canRename && !canDelete && !canPermanentDelete && !canDuplicate && !canShare && !node) {
    return null;
  }

  // List variant for mobile - renders flat list
  if (variant === 'list') {
    return (
      <>
        {canRename && (
          <ListMenuItem
            icon={<Pen className="size-4" />}
            label={t('table:table.rename')}
            onClick={() => onRename?.()}
          />
        )}
        {canDuplicate && (
          <ListMenuItem
            icon={<CopyPlus className="size-4" />}
            label={t('table:import.menu.duplicate')}
            onClick={handleDuplicateClick}
          />
        )}
        {shareNodeId && (
          <ListMenuItem
            icon={<Share2 className="size-4" />}
            label={t('common:template.non.share')}
            onClick={() => setShareDialogOpen(true)}
          />
        )}
        {node && (
          <ListMenuItem
            icon={<Info className="size-4" />}
            label={t('table:baseNode.info.menu')}
            onClick={() => setNodeInfoDialogOpen(true)}
          />
        )}
        {canPermanentDelete && (
          <ListMenuItem
            icon={<Trash className="size-4" />}
            label={t('common:actions.permanentDelete')}
            onClick={() => onDelete?.(true)}
            destructive
          />
        )}
        {canDelete && (
          <ListMenuItem
            icon={<Trash className="size-4" />}
            label={t('common:actions.delete')}
            onClick={() => onDelete?.(false)}
          />
        )}
        {duplicateDialog}
        {shareNodeId && (
          <NodeShareDialog
            open={shareDialogOpen}
            onOpenChange={setShareDialogOpen}
            nodeId={shareNodeId}
          />
        )}
        {node && (
          <BaseNodeInfoDialog
            node={node}
            open={nodeInfoDialogOpen}
            onOpenChange={setNodeInfoDialogOpen}
          />
        )}
      </>
    );
  }

  // Dropdown variant for desktop
  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
        <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
        <DropdownMenuContent
          align={contentAlign}
          className="min-w-[160px]"
          onClick={(e) => e.stopPropagation()}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          {canRename && (
            <DropdownMenuItem onClick={() => onRename?.()}>
              <Pen className="mr-2 size-4" />
              {t('table:table.rename')}
            </DropdownMenuItem>
          )}
          {canDuplicate && (
            <DropdownMenuItem onClick={handleDuplicateClick}>
              <CopyPlus className="mr-2 size-4" />
              {t('table:import.menu.duplicate')}
            </DropdownMenuItem>
          )}
          {shareNodeId && (
            <DropdownMenuItem onClick={() => setShareDialogOpen(true)}>
              <Share2 className="mr-2 size-4" />
              {t('common:template.non.share')}
            </DropdownMenuItem>
          )}
          {node && (
            <DropdownMenuItem onClick={() => setNodeInfoDialogOpen(true)}>
              <Info className="mr-2 size-4" />
              {t('table:baseNode.info.menu')}
            </DropdownMenuItem>
          )}
          {canPermanentDelete && (
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => onDelete?.(true)}
            >
              <Trash className="mr-2 size-4" />
              {t('common:actions.permanentDelete')}
            </DropdownMenuItem>
          )}
          {canDelete && (
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => onDelete?.(false)}
            >
              <Trash className="mr-2 size-4" />
              {t('common:actions.delete')}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {duplicateDialog}
      {shareNodeId && (
        <NodeShareDialog
          open={shareDialogOpen}
          onOpenChange={setShareDialogOpen}
          nodeId={shareNodeId}
        />
      )}
      {node && (
        <BaseNodeInfoDialog
          node={node}
          open={nodeInfoDialogOpen}
          onOpenChange={setNodeInfoDialogOpen}
        />
      )}
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
  const canShare = Boolean(permission?.['base|update']);

  return (
    <CommonOperation
      {...props}
      nodeTypeLabel={t('common:noun.dashboard')}
      canRename={canRename}
      canDelete={canDelete}
      canPermanentDelete={canPermanentDelete}
      canDuplicate={canDuplicate}
      canShare={canShare}
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
  const canShare = Boolean(permission?.['base|update']);

  return (
    <CommonOperation
      {...props}
      nodeTypeLabel={t('common:noun.automation')}
      canRename={canRename}
      canDelete={canDelete}
      canPermanentDelete={canPermanentDelete}
      canDuplicate={canDuplicate}
      canShare={canShare}
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
  const canShare = Boolean(permission?.['base|update']);

  return (
    <CommonOperation
      {...props}
      nodeTypeLabel={t('common:noun.app')}
      canRename={canRename}
      canDelete={canDelete}
      canPermanentDelete={canPermanentDelete}
      canDuplicate={canDuplicate}
      canShare={canShare}
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
  const canShare = Boolean(permission?.['base|update']);

  return (
    <CommonOperation
      {...props}
      canRename={canRename}
      canDelete={canDelete}
      canPermanentDelete={canPermanentDelete}
      canDuplicate={canDuplicate}
      canShare={canShare}
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
    contentAlign = 'end',
  } = props;

  const baseId = useBaseId() as string;
  const tables = useTables();
  const queryClient = useQueryClient();
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const basePermission = useBasePermission();
  const canTableRecordHistoryRead = basePermission?.['table_record_history|read'];
  const canTableTrashRead = basePermission?.['table|trash_read'];
  const node = useNode(resourceId);
  const nodeId = node?.id ?? '';
  const loginApps = useMemo(() => {
    const meta = node?.resourceMeta as IBaseNodeTableResourceMeta | undefined;
    if (meta?.loginApps?.length) return meta.loginApps;
    if (meta?.loginAppId) return [{ id: meta.loginAppId, name: '' }];
  }, [node]);

  const router = useRouter();
  const [apiDialogOpen, setApiDialogOpen] = useState(false);
  const [tableHistoryDialogOpen, setTableHistoryDialogOpen] = useState(false);
  const [tableTrashDialogOpen, setTableTrashDialogOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [importVisible, setImportVisible] = useState(false);
  const [duplicateSetting, setDuplicateSetting] = useState(false);
  const [importType, setImportType] = useState(SUPPORTEDTYPE.CSV);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [nodeInfoDialogOpen, setNodeInfoDialogOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const table = useMemo(() => tables.find((t) => t.id === resourceId), [tables, resourceId]);
  const tableName = table?.name ?? node?.resourceMeta?.name ?? resourceId;
  const { trigger } = useDownload({ downloadUrl: `/api/export/${resourceId}`, key: 'table' });

  const defaultTableName = useMemo(
    () =>
      getUniqName(
        `${tableName} ${t('space:baseModal.copy')}`,
        tables.map((t) => t.name)
      ),
    [t, tableName, tables]
  );

  const [duplicateOption, setDuplicateOption] = useState({
    includeRecords: true,
  });

  const menuPermission = useMemo(
    () =>
      getTableOperationMenuPermission({
        table,
        nodeExists: Boolean(node),
        basePermission,
        canTableRecordHistoryRead,
        canTableTrashRead,
      }),
    [basePermission, canTableRecordHistoryRead, canTableTrashRead, node, table]
  );
  const shareNodeId = menuPermission.shareTable && node ? node.id : undefined;

  const deleteTable = async (permanent: boolean) => {
    if (!resourceId) return;
    await onDelete?.(permanent, false);
    setDeleteConfirm(false);
    queryClient.invalidateQueries({ queryKey: ReactQueryKeys.getTrashItems(baseId as string) });
  };

  // Cross-space preview that drives the inline warning. We resolve this
  // BEFORE opening the duplicate dialog (see handleDuplicateClick below) so
  // the warning is part of the dialog's initial render rather than appearing
  // late after the user has already started configuring.
  const [affectedCrossSpace, setAffectedCrossSpace] = useState<Array<{
    fieldId: string;
    fieldName: string;
  }> | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);

  const handleDuplicateClick = async () => {
    if (!baseId || !resourceId) {
      setDuplicateSetting(true);
      return;
    }
    setIsPreviewing(true);
    try {
      const res = await duplicateTableCheck(baseId, resourceId);
      const affected = res.data.affectedFields;
      setAffectedCrossSpace(affected && affected.length > 0 ? affected : null);
    } catch {
      setAffectedCrossSpace(null);
    }
    setIsPreviewing(false);
    setDuplicateSetting(true);
  };

  const { mutateAsync: duplicateTableFn, isPending: isLoading } = useMutation({
    mutationFn: async (ro?: IDuplicateBaseNodeRo) => onDuplicate?.(ro),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.tableList(baseId as string),
      });
      setDuplicateSetting(false);
    },
    // Cross-space affected-fields are surfaced inline; bypass the global toast.
    meta: { preventGlobalError: true },
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

  if (!table && !node) {
    return null;
  }

  if (!nodeId && !Object.values(menuPermission).some(Boolean)) {
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
          title={t('table:table.deleteConfirm', { tableName })}
          content={
            <>
              <div className="space-y-2 text-sm">
                <p>{t('table:table.deleteTip1')}</p>
                <p>{t('common:trash.description')}</p>
                {loginApps && loginApps.length > 0 && (
                  <LoginAppWarning message={t('table:table.loginDeleteWarning')} apps={loginApps} />
                )}
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
            await duplicateTableFn({
              name: inputRef.current?.value?.trim() || defaultTableName,
              includeRecords: duplicateOption.includeRecords,
            });
          }}
        />
      )}

      {menuPermission.tableRecordHistory && (
        <Dialog open={tableHistoryDialogOpen} onOpenChange={setTableHistoryDialogOpen}>
          <DialogContent
            className="flex max-w-4xl flex-col gap-0 p-0 outline-none focus:outline-none focus-visible:outline-none"
            style={{ height: 'calc(100% - 100px)' }}
          >
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

      {shareNodeId && (
        <NodeShareDialog
          open={shareDialogOpen}
          onOpenChange={setShareDialogOpen}
          nodeId={shareNodeId}
        />
      )}
      {node && (
        <BaseNodeInfoDialog
          node={node}
          open={nodeInfoDialogOpen}
          onOpenChange={setNodeInfoDialogOpen}
        />
      )}
    </>
  );

  // List variant for mobile - renders flat list without dropdown wrapper
  if (variant === 'list') {
    return (
      <>
        {menuPermission.duplicateTable && (
          <ListMenuItem
            icon={<CopyPlus className="size-4" />}
            label={t('table:import.menu.duplicate')}
            onClick={() => {
              void handleDuplicateClick();
            }}
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
        {menuPermission.apiTable && (
          <ListMenuItem
            icon={<Code2 className="size-4" />}
            label="API"
            onClick={() => setApiDialogOpen(true)}
          />
        )}
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
                <Trash className="size-4" />
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
        {shareNodeId && (
          <ListMenuItem
            icon={<Share2 className="size-4" />}
            label={t('common:template.non.share')}
            onClick={() => setShareDialogOpen(true)}
          />
        )}
        {node && (
          <ListMenuItem
            icon={<Info className="size-4" />}
            label={t('table:baseNode.info.menu')}
            onClick={() => setNodeInfoDialogOpen(true)}
          />
        )}
        {menuPermission.deleteTable && (
          <ListMenuItem
            icon={<Trash className="size-4" />}
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
      <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
        <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
        <DropdownMenuContent
          align={contentAlign}
          className="min-w-[160px]"
          onClick={(e) => e.stopPropagation()}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          {menuPermission.updateTable && (
            <DropdownMenuItem onClick={() => onRename?.()}>
              <Pen className="mr-2 size-4" />
              {t('table:table.rename')}
            </DropdownMenuItem>
          )}
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

          {menuPermission.apiTable && (
            <DropdownMenuItem onClick={() => setApiDialogOpen(true)}>
              <Code2 className="mr-2 size-4" />
              API
            </DropdownMenuItem>
          )}

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
                      <Trash className="mr-1 size-4" />
                      {t('table:tableTrash.title')}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          )}

          {loginApps && loginApps.length > 0 && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <ShieldCheck className="mr-2 size-4" />
                <span>{t('table:table.linkedApps')}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent className="max-w-48">
                  {loginApps.map((app) => (
                    <DropdownMenuItem
                      key={app.id}
                      onClick={() => router.push(`/base/${baseId}/app/${app.id}`)}
                    >
                      <AppWindowMacIcon className="mr-2 size-4 shrink-0" />
                      <span className="truncate">{app.name || app.id}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          )}

          {shareNodeId && (
            <DropdownMenuItem onClick={() => setShareDialogOpen(true)}>
              <Share2 className="mr-2 size-4" />
              {t('common:template.non.share')}
            </DropdownMenuItem>
          )}

          {node && (
            <DropdownMenuItem onClick={() => setNodeInfoDialogOpen(true)}>
              <Info className="mr-2 size-4" />
              {t('table:baseNode.info.menu')}
            </DropdownMenuItem>
          )}

          {menuPermission.deleteTable && (
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => setDeleteConfirm(true)}
            >
              <Trash className="mr-2 size-4" />
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
