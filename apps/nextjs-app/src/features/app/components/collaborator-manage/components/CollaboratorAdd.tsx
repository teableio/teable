import { useMutation } from '@tanstack/react-query';
import { Role, type IBaseRole, type IRole } from '@teable/core';
import { Building2, Plus, X } from '@teable/icons';
import type { IAddCollaborator } from '@teable/openapi';
import {
  addBaseCollaborator,
  addSpaceCollaborator,
  CollaboratorType,
  PrincipalType,
} from '@teable/openapi';
import type { IMemberSelectorDialogRef, ISelectedMember } from '@teable/sdk/components';
import { MemberSelectorDialog, MemberSelectorNodeType, UserAvatar } from '@teable/sdk/components';
import { Spin } from '@teable/ui-lib/base';
import { Button } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useCallback, useRef, useState } from 'react';
import {
  useFilteredRoleStatic,
  useFilteredRoleStatic as useFilteredBaseRoleStatic,
} from '../base/useFilteredRoleStatic';
import { RoleSelect } from './RoleSelect';

interface ICollaboratorAddProps {
  resourceId: string;
  resourceType: CollaboratorType;
  currentRole: IRole;
  onConfirm?: () => void;
}

export const CollaboratorAdd = (props: ICollaboratorAddProps) => {
  const { resourceId, resourceType, currentRole, onConfirm } = props;
  const isBase = resourceType === CollaboratorType.Base;
  const { t } = useTranslation(['common']);
  const [role, setRole] = useState<IRole>(() =>
    isBase && currentRole === Role.Owner ? Role.Creator : currentRole
  );

  const memberSelectorRef = useRef<IMemberSelectorDialogRef>(null);
  const filteredRoleStatic = useFilteredRoleStatic(currentRole);
  const filteredBaseRoleStatic = useFilteredBaseRoleStatic(currentRole);
  const [selectedMembers, setSelectedMembers] = useState<ISelectedMember[]>([]);

  const { mutate: addCollaborators, isLoading } = useMutation({
    mutationFn: async (collaborators: IAddCollaborator[]) => {
      const userCollaborators = collaborators.filter((c) => c.principalType === PrincipalType.User);
      const departmentCollaborators = collaborators.filter(
        (c) => c.principalType === PrincipalType.Department
      );
      if (userCollaborators.length > 0) {
        if (isBase) {
          await addBaseCollaborator(resourceId, {
            collaborators: userCollaborators,
            role: role as IBaseRole,
          });
        } else {
          await addSpaceCollaborator(resourceId, {
            collaborators: userCollaborators,
            role: role as IRole,
          });
        }
      }
      if (departmentCollaborators.length > 0) {
        if (isBase) {
          await addBaseCollaborator(resourceId, {
            collaborators: departmentCollaborators,
            role: role as IBaseRole,
          });
        } else {
          await addSpaceCollaborator(resourceId, {
            collaborators: departmentCollaborators,
            role: role as IRole,
          });
        }
      }
    },
    onSuccess: () => {
      setSelectedMembers([]);
      onConfirm?.();
    },
  });

  const onLoadData = useCallback(() => {
    return selectedMembers;
  }, [selectedMembers]);

  const deleteMember = (id: string) => {
    setSelectedMembers(selectedMembers.filter((m) => m.id !== id));
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {t('common:invite.addOrgCollaborator.title')}
        </div>
        <div className="flex items-center gap-2">
          <RoleSelect
            value={role}
            onChange={setRole}
            options={isBase ? filteredBaseRoleStatic : filteredRoleStatic}
          />
          <Button
            size={'sm'}
            className="h-7 w-20"
            onClick={() => {
              addCollaborators(
                selectedMembers.map((m) => ({
                  principalId: m.id,
                  principalType:
                    m.type === MemberSelectorNodeType.USER
                      ? PrincipalType.User
                      : PrincipalType.Department,
                }))
              );
            }}
            disabled={isLoading}
          >
            {isLoading && <Spin />}
            {t('common:actions.add')}
          </Button>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <Button
            size={'sm'}
            variant={'link'}
            className="h-7"
            disabled={isLoading}
            onClick={() => {
              memberSelectorRef.current?.open();
            }}
          >
            <Plus />
            {t('common:invite.addOrgCollaborator.placeholder')}
          </Button>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
        {selectedMembers.map((member) => {
          if (member.type === MemberSelectorNodeType.USER) {
            return (
              <div
                key={member.id}
                className="flex items-center gap-1.5 rounded-full border p-1 text-[13px]"
              >
                <UserAvatar avatar={member.data.avatar} name={member.data.name} />
                {member.data.name}
                <Button
                  className="h-6"
                  disabled={isLoading}
                  size={'xs'}
                  variant={'ghost'}
                  onClick={() => {
                    deleteMember(member.id);
                  }}
                >
                  <X />
                </Button>
              </div>
            );
          }
          return (
            <div
              key={member.id}
              className="flex items-center gap-1.5 rounded-full border p-1 text-[13px]"
            >
              <Building2 className="ml-2 size-4" />
              {member.data.name}
              <Button
                className="h-6"
                disabled={isLoading}
                size={'xs'}
                variant={'ghost'}
                onClick={() => {
                  deleteMember(member.id);
                }}
              >
                <X />
              </Button>
            </div>
          );
        })}
      </div>
      <MemberSelectorDialog
        ref={memberSelectorRef}
        onConfirm={setSelectedMembers}
        onLoadData={onLoadData}
      />
    </div>
  );
};
