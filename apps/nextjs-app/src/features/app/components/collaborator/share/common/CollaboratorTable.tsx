import type { IRole } from '@teable/core';
import { PrincipalType } from '@teable/openapi';
import type { CollaboratorItem } from '@teable/openapi';
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
import { Loader, LogOut } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { Collaborator } from '../../../collaborator-manage/components/Collaborator';
import { RoleSelect } from '../../../collaborator-manage/components/RoleSelect';
import type { IRoleStatic } from '../../../collaborator-manage/types';
import { useRoleStatic } from '../../../collaborator-manage/useRoleStatic';

interface ICollaboratorTableProps {
  className?: string;
  list: CollaboratorItem[];
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
}

export const CollaboratorTable = (props: ICollaboratorTableProps) => {
  const {
    className,
    list,
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
  } = props;
  const { t } = useTranslation('common');
  const roleStatic = useRoleStatic();

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col gap-4', className)}>
      <div className="flex-1 overflow-y-auto rounded-md border">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow>
              <TableHead className="px-4 font-normal">{t('invite.table.collaborator')}</TableHead>
              <TableHead className="px-4 font-normal">
                {t('invite.table.accessPermission')}
              </TableHead>
              <TableHead className="w-[156px] px-4 font-normal">
                {t('invite.table.joinAt')}
              </TableHead>
              <TableHead className="w-[100px] px-4 font-normal">{t('actions.title')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((item) => {
              const isUser = item.type === PrincipalType.User;
              const { canUpdateRole, canDelete, showDelete } = getPermissions(item);
              return (
                <TableRow className="h-14" key={isUser ? item.userId : item.departmentId}>
                  <TableCell className="px-4">
                    <Collaborator
                      className="items-center"
                      item={
                        isUser
                          ? {
                              type: PrincipalType.User as const,
                              name: item.userName,
                              email: item.email,
                              avatar: item.avatar,
                            }
                          : {
                              type: PrincipalType.Department as const,
                              name: item.departmentName,
                            }
                      }
                      tips={renderTips?.(item)}
                    />
                  </TableCell>
                  <TableCell className="px-4">
                    <RoleSelect
                      className="text-[13px]"
                      value={item.role}
                      options={getFilteredRoleStatic?.(item) || filteredRoleStatic || roleStatic}
                      disabled={updateRoleLoading || !onUpdateRole || !canUpdateRole}
                      onChange={(role) => onUpdateRole?.(role, item)}
                    />
                  </TableCell>
                  <TableCell className="px-4">
                    <span className="text-sm text-muted-foreground">
                      {new Date(item.createdTime).toLocaleDateString()}
                    </span>
                  </TableCell>
                  <TableCell className="px-4">
                    {showDelete && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="size-8 p-0 text-muted-foreground"
                              onClick={() => onDelete(item)}
                              disabled={deleteLoading || !canDelete}
                            >
                              {deleteLoading ? (
                                <Spin className="size-4" />
                              ) : (
                                <LogOut className="size-4" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{t('invite.dialog.collaboratorRemove')}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </TableCell>
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
          <Button variant="link" size="sm" className="text-[13px]" onClick={() => fetchNextPage()}>
            {t('actions.loadMore')} ({list.length} / {total})
          </Button>
        </div>
      )}
    </div>
  );
};
