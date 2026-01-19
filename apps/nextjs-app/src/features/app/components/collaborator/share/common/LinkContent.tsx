import type { IBaseRole, IRole } from '@teable/core';
import { ChevronLeft, UserPlus } from '@teable/icons';
import type { ListSpaceInvitationLinkVo } from '@teable/openapi';
import { Spin } from '@teable/ui-lib/base';
import { Button, Separator } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { InviteLinkItem } from '../../../collaborator-manage/components/InviteLinkItem';
import { RoleSelect } from '../../../collaborator-manage/components/RoleSelect';
import type { IRoleStatic } from '../../../collaborator-manage/types';

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
            <div className="space-y-3">
              {list.map((item) => (
                <InviteLinkItem
                  key={item.invitationId}
                  url={item.inviteUrl}
                  createdTime={item.createdTime}
                  onDelete={() => onDelete(item.invitationId)}
                  deleteDisabled={isDeleteLoading}
                >
                  <RoleSelect
                    value={item.role}
                    options={filteredRoleStatic}
                    disabled={isUpdateLoading}
                    onChange={(role) => onUpdate(item.invitationId, role)}
                  />
                </InviteLinkItem>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
