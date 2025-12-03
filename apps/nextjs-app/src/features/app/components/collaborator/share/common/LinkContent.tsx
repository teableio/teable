import type { IBaseRole, IRole } from '@teable/core';
import { ChevronLeft, Trash, UserPlus } from '@teable/icons';
import type { ListSpaceInvitationLinkVo } from '@teable/openapi';
import { Spin } from '@teable/ui-lib/base';
import { Button, Separator } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { RoleSelect } from '../../../collaborator-manage/components/RoleSelect';
import type { IRoleStatic } from '../../../collaborator-manage/types';
import { CopyButton } from '../../../CopyButton';

interface ILinkContentProps {
  list?: ListSpaceInvitationLinkVo;
  defaultRole: IRole;
  filteredRoleStatic: IRoleStatic[];
  isCreateLoading?: boolean;
  isUpdateLoading?: boolean;
  isDeleteLoading?: boolean;
  onCreate: (role: IRole) => void;
  onUpdate: (invitationId: string, role: IRole) => void;
  onDelete: (invitationId: string) => void;
  onBack: () => void;
}
export const LinkContent = ({
  list,
  defaultRole,
  filteredRoleStatic,
  isCreateLoading,
  isUpdateLoading,
  isDeleteLoading,
  onCreate,
  onUpdate,
  onDelete,
  onBack,
}: ILinkContentProps) => {
  const [selectedRole, setSelectedRole] = useState<IRole>(defaultRole);
  const { t } = useTranslation('common');
  return (
    <div className="flex flex-col gap-4">
      <Button
        variant="link"
        size="sm"
        className="h-auto justify-start gap-2 p-0 text-sm font-semibold hover:no-underline"
        onClick={onBack}
      >
        <ChevronLeft className="size-4" />
        {t('invite.dialog.tabLink')}
      </Button>
      <div className="space-y-2">
        <div className="flex flex-col gap-2">
          <p className="text-sm">{t('invite.dialog.linkDescription')}</p>
        </div>
        <div className="flex items-center justify-between">
          <RoleSelect
            value={selectedRole}
            options={filteredRoleStatic}
            onChange={(role) => setSelectedRole(role as IBaseRole)}
          />
          <Button
            size="sm"
            className="text-sm font-normal"
            disabled={isCreateLoading}
            onClick={() => onCreate(selectedRole)}
          >
            {isCreateLoading ? <Spin className="size-4" /> : <UserPlus className="size-4" />}
            {t('invite.dialog.linkSend')}
          </Button>
        </div>
      </div>
      {list && list.length > 0 && (
        <>
          <Separator />
          <div>
            <p className="mb-2 text-sm font-medium">{t('invite.dialog.linkTitle')}</p>
            {list?.map((item, index) => (
              <div
                key={item.invitationId}
                className={`flex items-center gap-2 py-2 ${
                  index !== list.length - 1 ? 'border-b' : ''
                }`}
              >
                <div className="flex flex-1 items-center gap-2 overflow-hidden">
                  <div className="flex flex-col gap-1 overflow-hidden">
                    <p className="truncate text-sm" title={item.inviteUrl}>
                      {item.inviteUrl}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(item.createdTime).toLocaleDateString()}
                    </p>
                  </div>
                  <RoleSelect
                    className="shrink-0"
                    value={item.role}
                    options={filteredRoleStatic}
                    disabled={isUpdateLoading}
                    onChange={(role) => onUpdate(item.invitationId, role)}
                  />
                  <div className="flex items-center gap-0">
                    {' '}
                    <CopyButton
                      size="xs"
                      variant="ghost"
                      className="text-muted-foreground"
                      iconClassName="size-4"
                      text={item.inviteUrl}
                    />
                    <Button
                      size="xs"
                      variant="ghost"
                      className="text-muted-foreground"
                      disabled={isDeleteLoading}
                      onClick={() => onDelete(item.invitationId)}
                    >
                      {isDeleteLoading ? <Spin className="size-4" /> : <Trash className="size-4" />}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
