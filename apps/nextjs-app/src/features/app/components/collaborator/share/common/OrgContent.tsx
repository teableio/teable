import type { IRole } from '@teable/core';
import { Building2, ChevronLeft, Plus, UserPlus, X } from '@teable/icons';
import { PrincipalType } from '@teable/openapi';
import { MemberSelectorDialog, UserAvatar } from '@teable/sdk/components';
import type { IMemberSelectorDialogRef, ISelectedMember } from '@teable/sdk/components';
import { TreeNodeType } from '@teable/sdk/components/member-selector/types';
import { Button, ScrollArea } from '@teable/ui-lib/shadcn';
import { Loader } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useCallback, useRef, useState } from 'react';
import { RoleSelect } from '../../../collaborator-manage/components/RoleSelect';
import type { IRoleStatic } from '../../../collaborator-manage/types';

interface IOrgContentProps {
  defaultRole: IRole;
  onBack: () => void;
  filteredRoleStatic: IRoleStatic[];
  isCreateLoading: boolean;
  onCreate: (role: IRole, members: { principalId: string; principalType: PrincipalType }[]) => void;
}
export const OrgContent = ({
  defaultRole,
  onBack,
  filteredRoleStatic,
  isCreateLoading,
  onCreate,
}: IOrgContentProps) => {
  const { t } = useTranslation('common');
  const [selectedRole, setSelectedRole] = useState<IRole>(defaultRole);
  const [selectedMembers, setSelectedMembers] = useState<ISelectedMember[]>([]);
  const memberSelectorRef = useRef<IMemberSelectorDialogRef>(null);
  const onLoadData = useCallback(() => {
    return selectedMembers;
  }, [selectedMembers]);

  const deleteMember = (id: string) => {
    setSelectedMembers(selectedMembers.filter((m) => m.id !== id));
  };
  return (
    <div className="flex flex-col gap-4">
      <Button
        variant="link"
        size="sm"
        className="h-auto justify-start gap-2 p-0 text-sm font-semibold hover:no-underline"
        onClick={onBack}
      >
        <ChevronLeft className="size-4" />
        {t('invite.addOrgCollaborator.title')}
      </Button>
      <div className="space-y-4">
        <div className="relative">
          <div className="flex h-20 flex-1 flex-wrap gap-1 rounded-md border border-input bg-background p-2 text-sm shadow-sm transition-colors">
            <ScrollArea className="size-full">
              <div className="flex flex-1 flex-wrap gap-1 text-sm transition-colors">
                {selectedMembers.map((member) => (
                  <div
                    key={member.id}
                    className="flex h-6 items-center gap-1 rounded-full border bg-secondary pr-2 text-[13px]"
                  >
                    {member.data.type === TreeNodeType.USER ? (
                      <UserAvatar
                        avatar={member.data.avatar}
                        name={member.data.name}
                        className="size-[22px] bg-transparent"
                      />
                    ) : (
                      <div className="flex size-[22px] items-center justify-center rounded-full border">
                        <Building2 className="size-[16px]" />
                      </div>
                    )}
                    {member.data.name}
                    <X
                      className="cursor-pointer hover:opacity-70"
                      onClick={() => deleteMember(member.id)}
                    />
                  </div>
                ))}
                {selectedMembers.length === 0 && (
                  <span className="text-sm text-muted-foreground">
                    {t('invite.addOrgCollaborator.placeholder')}
                  </span>
                )}
              </div>
            </ScrollArea>
          </div>
          <Button
            size={'sm'}
            variant={'outline'}
            className="absolute bottom-1 right-1 h-auto p-1"
            disabled={isCreateLoading}
            onClick={() => {
              memberSelectorRef.current?.open();
            }}
          >
            <Plus />
          </Button>
        </div>
        <div className="flex items-center justify-between">
          <RoleSelect
            value={selectedRole}
            options={filteredRoleStatic}
            onChange={(role) => setSelectedRole(role)}
          />
          <Button
            size="sm"
            className="text-sm font-normal"
            disabled={selectedMembers.length === 0 || isCreateLoading}
            onClick={() =>
              onCreate(
                selectedRole,
                selectedMembers.map((m) => ({
                  principalId: m.data.id,
                  principalType:
                    m.data.type === TreeNodeType.USER
                      ? PrincipalType.User
                      : PrincipalType.Department,
                }))
              )
            }
          >
            {isCreateLoading ? (
              <Loader className="size-4 animate-spin" />
            ) : (
              <UserPlus className="size-4" />
            )}
            {t('actions.add')}
          </Button>
        </div>
      </div>
      <MemberSelectorDialog
        ref={memberSelectorRef}
        onConfirm={setSelectedMembers}
        onLoadData={onLoadData}
      />
    </div>
  );
};
