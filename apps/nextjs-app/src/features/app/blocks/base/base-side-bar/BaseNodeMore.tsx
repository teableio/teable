/* eslint-disable sonarjs/no-identical-functions */
import { Copy, MoreHorizontal, Pencil, Trash2 } from '@teable/icons';
import { BaseNodeResourceType } from '@teable/openapi';
import { useBasePermission, useTables } from '@teable/sdk/hooks';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { tableConfig } from '@/features/i18n/table.config';
import { TableOperation as TableOperationComponent } from '../../table-list/TableOperation';

interface IBaseNodeMoreProps {
  resourceType: BaseNodeResourceType;
  resourceId: string;

  className?: string;

  open?: boolean;
  setOpen?: (open: boolean) => void;

  onRename?: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
}

interface ICommonOperationProps extends IBaseNodeMoreProps {
  children?: React.ReactNode;
  canRename?: boolean;
  canDelete?: boolean;
  canDuplicate?: boolean;
}

const CommonOperation = (props: ICommonOperationProps) => {
  const {
    onRename,
    onDuplicate,
    onDelete,
    children,
    canRename = true,
    canDelete = true,
    canDuplicate = true,
    className,
  } = props;
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  if (!canRename && !canDelete && !canDuplicate && !children) {
    return null;
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <div>
            <MoreHorizontal className={className} />
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-[160px]"
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
            <DropdownMenuItem onClick={onDuplicate}>
              <Copy className="mr-2" />
              {t('table:import.menu.duplicate')}
            </DropdownMenuItem>
          )}
          {canDelete && (
            <DropdownMenuItem className="text-destructive" onClick={onDelete}>
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
  const canRename = Boolean(permission?.['base|update']);
  const canDelete = Boolean(permission?.['base|update']);
  const canDuplicate = Boolean(permission?.['base|update']);
  return (
    <CommonOperation
      {...props}
      canRename={canRename}
      canDelete={canDelete}
      canDuplicate={canDuplicate}
    />
  );
};

export const WorkflowOperation = (props: IBaseNodeMoreProps) => {
  const permission = useBasePermission();
  const canRename = Boolean(permission?.['automation|update']);
  const canDelete = Boolean(permission?.['automation|delete']);
  const canDuplicate = Boolean(permission?.['automation|create']);
  return (
    <CommonOperation
      {...props}
      canRename={canRename}
      canDelete={canDelete}
      canDuplicate={canDuplicate}
    />
  );
};

export const AppOperation = (props: IBaseNodeMoreProps) => {
  const permission = useBasePermission();
  const canRename = Boolean(permission?.['base|update']);
  const canDelete = Boolean(permission?.['base|update']);
  const canDuplicate = false;
  return (
    <CommonOperation
      {...props}
      canRename={canRename}
      canDelete={canDelete}
      canDuplicate={canDuplicate}
    />
  );
};

export const FolderOperation = (props: IBaseNodeMoreProps) => {
  const permission = useBasePermission();
  const canRename = Boolean(permission?.['base|update']);
  const canDelete = Boolean(permission?.['base|update']);
  const canDuplicate = false;
  return (
    <CommonOperation
      {...props}
      canRename={canRename}
      canDelete={canDelete}
      canDuplicate={canDuplicate}
    />
  );
};

export const TableOperation = (props: IBaseNodeMoreProps) => {
  const { resourceId, open, setOpen, onRename, className } = props;
  const tables = useTables();
  const table = useMemo(() => tables.find((t) => t.id === resourceId), [tables, resourceId]);
  if (!table) {
    return null;
  }
  return (
    <TableOperationComponent
      table={table}
      open={open}
      setOpen={setOpen}
      onRename={onRename}
      className={className}
    />
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
