import { useQuery } from '@tanstack/react-query';
import type { IRole } from '@teable/core';
import { Database } from '@teable/icons';
import { CollaboratorType, getSpaceCollaboratorList, PrincipalType } from '@teable/openapi';
import type { CollaboratorItem, UniqueCollaboratorItem } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { Spin } from '@teable/ui-lib/base';
import {
  Button,
  cn,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn';
import { ChevronDown, ChevronRight, Loader, LogOut, X } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { Fragment, useState } from 'react';
import { BaseCountBadge } from '../../../collaborator-manage/components/BaseCountBadge';
import { Collaborator } from '../../../collaborator-manage/components/Collaborator';
import { RoleSelect } from '../../../collaborator-manage/components/RoleSelect';
import type { IRoleStatic } from '../../../collaborator-manage/types';
import { useRoleStatic } from '../../../collaborator-manage/useRoleStatic';
import {
  getUniqueCollaboratorPrincipalId,
  PRINCIPAL_PERMISSIONS_TAKE,
  uniqueCollaboratorToSpaceItem,
} from '../../../collaborator-manage/utils';

interface ICollaboratorTableProps {
  className?: string;
  // Row-level items for the flat mode
  list?: CollaboratorItem[];
  // Principal-level items for the grouped mode; requires `spaceId` so
  // base permissions of a principal can be fetched lazily on expand
  uniqueList?: UniqueCollaboratorItem[];
  spaceId?: string;
  total: number;
  hasNextPage?: boolean;
  fetchNextPage: () => void;
  isLoading: boolean;
  updateRoleLoading: boolean;
  deleteLoading: boolean;
  filteredRoleStatic?: IRoleStatic[];
  onUpdateRole?: (role: IRole, item: CollaboratorItem) => void;
  onDelete: (item: CollaboratorItem) => void;
  getPermissions: (item: CollaboratorItem) => {
    canUpdateRole: boolean;
    canDelete: boolean;
    showDelete: boolean;
  };
  getFilteredRoleStatic?: (item: CollaboratorItem) => IRoleStatic[];
  renderTips?: (item: CollaboratorItem) => React.ReactNode;
  groupByPrincipal?: boolean;
  // Remove every base grant of a base-only principal in one action
  onDeletePrincipal?: (item: UniqueCollaboratorItem) => void;
}

interface IPrincipalPermissionRowsProps {
  spaceId: string;
  principalId: string;
  renderRole: (item: CollaboratorItem) => React.ReactNode;
  renderDelete: (item: CollaboratorItem) => React.ReactNode;
  renderTips?: (item: CollaboratorItem) => React.ReactNode;
}

const PrincipalPermissionRows = (props: IPrincipalPermissionRowsProps) => {
  const { spaceId, principalId, renderRole, renderDelete, renderTips } = props;
  const { data, isLoading } = useQuery({
    queryKey: ReactQueryKeys.spaceCollaboratorList(spaceId, {
      includeBase: true,
      principalId,
      take: PRINCIPAL_PERMISSIONS_TAKE,
    }),
    queryFn: ({ queryKey }) =>
      getSpaceCollaboratorList(queryKey[1], queryKey[2]).then((res) => res.data),
  });
  const permissions = (data?.collaborators ?? []).filter(
    (item) => item.resourceType === CollaboratorType.Base
  );

  if (isLoading) {
    return (
      <TableRow className="h-12 bg-muted [&>td]:py-1">
        <TableCell colSpan={5}>
          <div className="flex justify-center py-1">
            <Loader className="size-4 animate-spin" />
          </div>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <>
      {permissions.map((item) => (
        <TableRow
          className="h-12 bg-muted hover:bg-accent [&>td]:py-1"
          key={`${item.resourceType}-${item.base?.id ?? 'space'}`}
        >
          <TableCell className="min-w-0 px-2">
            <div className="flex min-w-0 items-center gap-1">
              <span className="size-8 shrink-0" aria-hidden="true" />
              <div className="ms-10 flex min-w-0 flex-1 items-center">
                <Database className="size-4 text-muted-foreground" aria-hidden="true" />
                <div className="ms-2 flex min-w-0 flex-1 items-center gap-2">
                  <span className="truncate text-sm" title={item.base?.name}>
                    {item.base?.name}
                  </span>
                  {renderTips?.(item)}
                </div>
              </div>
            </div>
          </TableCell>
          <TableCell className="px-4">{renderRole(item)}</TableCell>
          <TableCell className="px-4">
            <span className="text-sm text-muted-foreground">
              {new Date(item.createdTime).toLocaleDateString()}
            </span>
          </TableCell>
          <TableCell />
          <TableCell className="px-4">{renderDelete(item)}</TableCell>
        </TableRow>
      ))}
    </>
  );
};

export const CollaboratorTable = (props: ICollaboratorTableProps) => {
  const {
    className,
    list,
    uniqueList,
    spaceId,
    total,
    getPermissions,
    hasNextPage,
    fetchNextPage,
    isLoading,
    updateRoleLoading,
    deleteLoading,
    filteredRoleStatic,
    onUpdateRole,
    onDelete,
    renderTips,
    getFilteredRoleStatic,
    groupByPrincipal = false,
    onDeletePrincipal,
  } = props;
  const { t } = useTranslation('common');
  const roleStatic = useRoleStatic();
  const [expandedPrincipalKeys, setExpandedPrincipalKeys] = useState<Set<string>>(new Set());
  const loadedCount = groupByPrincipal ? uniqueList?.length ?? 0 : list?.length ?? 0;

  const getPrincipal = (item: CollaboratorItem | UniqueCollaboratorItem) => {
    return item.type === PrincipalType.User
      ? {
          type: PrincipalType.User as const,
          name: item.userName,
          email: item.email,
          avatar: item.avatar,
        }
      : {
          type: PrincipalType.Department as const,
          name: item.departmentName,
        };
  };

  const renderRole = (item: CollaboratorItem) => {
    const { canUpdateRole } = getPermissions(item);
    return (
      <RoleSelect
        className="text-[13px]"
        value={item.role}
        options={getFilteredRoleStatic?.(item) || filteredRoleStatic || roleStatic}
        disabled={updateRoleLoading || !onUpdateRole || !canUpdateRole}
        onChange={(role) => onUpdateRole?.(role, item)}
      />
    );
  };

  const renderDelete = (item: CollaboratorItem) => {
    const { canDelete, showDelete } = getPermissions(item);
    if (!showDelete) return null;
    const isBasePermission = groupByPrincipal && item.resourceType === CollaboratorType.Base;
    const label = t(
      isBasePermission ? 'invite.dialog.basePermissionRemove' : 'invite.dialog.collaboratorRemove'
    );

    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="size-8 p-0 text-muted-foreground"
              aria-label={label}
              onClick={() => onDelete(item)}
              disabled={deleteLoading || !canDelete}
            >
              {deleteLoading ? (
                <Spin className="size-4" />
              ) : isBasePermission ? (
                <X className="size-4" />
              ) : (
                <LogOut className="size-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{label}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };

  const renderDeletePrincipal = (item: UniqueCollaboratorItem) => {
    if (!onDeletePrincipal) return null;
    const { canDelete, showDelete } = getPermissions(uniqueCollaboratorToSpaceItem(item));
    if (!showDelete) return null;
    const label = t('invite.dialog.collaboratorRemove');
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="size-8 p-0 text-muted-foreground"
              aria-label={label}
              onClick={(event) => {
                event.stopPropagation();
                onDeletePrincipal(item);
              }}
              disabled={deleteLoading || !canDelete}
            >
              {deleteLoading ? <Spin className="size-4" /> : <LogOut className="size-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{label}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };

  const togglePrincipal = (key: string) => {
    setExpandedPrincipalKeys((previous) => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col gap-4', className)}>
      <div className="min-h-0 flex-1 overflow-auto rounded-md border">
        <Table className={cn('table-fixed', groupByPrincipal && 'min-w-[700px]')}>
          <TableHeader className="sticky top-0 z-10 bg-background [&_th]:shadow-[inset_0_-1px_0_hsl(var(--border))] [&_tr]:border-0">
            <TableRow className="hover:bg-background">
              <TableHead className="px-4 font-normal">{t('invite.table.collaborator')}</TableHead>
              <TableHead className="w-[160px] px-4 font-normal">
                {t('invite.table.accessPermission')}
              </TableHead>
              <TableHead
                className={cn('px-4 font-normal', groupByPrincipal ? 'w-[105px]' : 'w-[120px]')}
              >
                {t('invite.table.joinAt')}
              </TableHead>
              <TableHead
                className={cn('px-4 font-normal', groupByPrincipal ? 'w-[105px]' : 'w-[120px]')}
              >
                {t('invite.table.lastLogin')}
              </TableHead>
              <TableHead className={cn('px-4 font-normal', groupByPrincipal ? 'w-20' : 'w-[88px]')}>
                {t('actions.title')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groupByPrincipal
              ? (uniqueList ?? []).map((item) => {
                  const principalId = getUniqueCollaboratorPrincipalId(item);
                  const key = `${item.type}:${principalId}`;
                  const isCollapsed = !expandedPrincipalKeys.has(key);
                  const principalName =
                    item.type === PrincipalType.User ? item.userName : item.departmentName;
                  const expandToggle = (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="size-8 shrink-0 p-0 text-muted-foreground"
                      aria-expanded={!isCollapsed}
                      aria-label={t(
                        isCollapsed
                          ? 'invite.table.expandPermissions'
                          : 'invite.table.collapsePermissions',
                        { name: principalName }
                      )}
                      onClick={(event) => {
                        event.stopPropagation();
                        togglePrincipal(key);
                      }}
                    >
                      {isCollapsed ? (
                        <ChevronRight className="size-4" />
                      ) : (
                        <ChevronDown className="size-4" />
                      )}
                    </Button>
                  );

                  if (item.spaceRole) {
                    const spaceItem = uniqueCollaboratorToSpaceItem(item);
                    const hasBaseGrants = item.baseCount > 0;
                    return (
                      <Fragment key={key}>
                        <TableRow className="h-14 bg-background">
                          <TableCell className="min-w-0 px-2">
                            <div className="flex min-w-0 items-center gap-1">
                              {hasBaseGrants ? (
                                expandToggle
                              ) : (
                                <span className="size-8 shrink-0" aria-hidden="true" />
                              )}
                              <Collaborator
                                className="min-w-0 items-center"
                                item={getPrincipal(spaceItem)}
                              />
                            </div>
                          </TableCell>
                          <TableCell className="px-4">
                            <div className="flex items-center gap-2">
                              {renderRole(spaceItem)}
                              {hasBaseGrants && (
                                <BaseCountBadge
                                  count={item.baseCount}
                                  label={t('invite.table.basePermissionCount', {
                                    count: item.baseCount,
                                  })}
                                />
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="px-4">
                            <span className="text-sm text-muted-foreground">
                              {new Date(spaceItem.createdTime).toLocaleDateString()}
                            </span>
                          </TableCell>
                          <TableCell className="px-4">
                            <span className="text-sm text-muted-foreground">
                              {spaceItem.type === PrincipalType.User && spaceItem.lastSignTime
                                ? new Date(spaceItem.lastSignTime).toLocaleDateString()
                                : '-'}
                            </span>
                          </TableCell>
                          <TableCell className="px-4">{renderDelete(spaceItem)}</TableCell>
                        </TableRow>
                        {hasBaseGrants && !isCollapsed && spaceId && (
                          <PrincipalPermissionRows
                            spaceId={spaceId}
                            principalId={principalId}
                            renderRole={renderRole}
                            renderDelete={renderDelete}
                            renderTips={renderTips}
                          />
                        )}
                      </Fragment>
                    );
                  }
                  return (
                    <Fragment key={key}>
                      <TableRow
                        className="h-14 cursor-pointer bg-background"
                        onClick={() => togglePrincipal(key)}
                      >
                        <TableCell className="min-w-0 px-2">
                          <div className="flex min-w-0 items-center gap-1">
                            {expandToggle}
                            <Collaborator
                              className="min-w-0 items-center"
                              item={getPrincipal(item)}
                            />
                          </div>
                        </TableCell>
                        <TableCell className="px-4">
                          <BaseCountBadge
                            count={item.baseCount}
                            label={t('invite.table.basePermissionsOnly')}
                          />
                        </TableCell>
                        <TableCell className="px-4">
                          <span className="text-sm text-muted-foreground">
                            {new Date(item.createdTime).toLocaleDateString()}
                          </span>
                        </TableCell>
                        <TableCell className="px-4">
                          <span className="text-sm text-muted-foreground">
                            {item.type === PrincipalType.User && item.lastSignTime
                              ? new Date(item.lastSignTime).toLocaleDateString()
                              : '-'}
                          </span>
                        </TableCell>
                        <TableCell className="px-4">{renderDeletePrincipal(item)}</TableCell>
                      </TableRow>
                      {!isCollapsed && spaceId && (
                        <PrincipalPermissionRows
                          spaceId={spaceId}
                          principalId={principalId}
                          renderRole={renderRole}
                          renderDelete={renderDelete}
                          renderTips={renderTips}
                        />
                      )}
                    </Fragment>
                  );
                })
              : (list ?? []).map((item) => {
                  const isUser = item.type === PrincipalType.User;
                  return (
                    <TableRow
                      className="h-14 bg-background"
                      key={`${isUser ? item.userId : item.departmentId}-${item.base?.id ?? ''}`}
                    >
                      <TableCell className="min-w-0 px-4">
                        <Collaborator
                          className="items-center"
                          item={getPrincipal(item)}
                          tips={renderTips?.(item)}
                        />
                      </TableCell>
                      <TableCell className="px-4">{renderRole(item)}</TableCell>
                      <TableCell className="px-4">
                        <span className="text-sm text-muted-foreground">
                          {new Date(item.createdTime).toLocaleDateString()}
                        </span>
                      </TableCell>
                      <TableCell className="px-4">
                        <span className="text-sm text-muted-foreground">
                          {item.type === PrincipalType.User && item.lastSignTime
                            ? new Date(item.lastSignTime).toLocaleDateString()
                            : '-'}
                        </span>
                      </TableCell>
                      <TableCell className="px-4">{renderDelete(item)}</TableCell>
                    </TableRow>
                  );
                })}
          </TableBody>
        </Table>
      </div>
      {isLoading && (
        <div className="flex w-full justify-center py-2">
          <Loader className="size-4 animate-spin" />
        </div>
      )}
      {hasNextPage && (
        <div className="flex justify-center py-2">
          <Button variant="link" size="sm" onClick={() => fetchNextPage()}>
            {t('actions.loadMore')} ({loadedCount} / {total})
          </Button>
        </div>
      )}
    </div>
  );
};
