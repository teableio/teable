import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { IBaseRole, IRole } from '@teable/core';
import { hasPermission, Role } from '@teable/core';
import { createBaseInvitationLink, emailBaseInvitation } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useState } from 'react';
import { Invite } from '../components/Invite';
import { RoleSelect } from '../components/RoleSelect';
import { useFilteredRoleStatic } from './useFilteredRoleStatic';

export const BaseInvite = (props: { baseId: string; role: IRole }) => {
  const { role, baseId } = props;
  const [inviteRole, setInviteRole] = useState<IBaseRole>(
    role === Role.Owner ? Role.Creator : role
  );
  const queryClient = useQueryClient();

  const { mutate: emailInvitation, isLoading: updateCollaboratorLoading } = useMutation({
    mutationFn: emailBaseInvitation,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.baseCollaboratorList(baseId),
      });
    },
  });

  const sendInviteEmail = async (emails: string[]) => {
    emailInvitation({
      baseId,
      emailBaseInvitationRo: {
        emails,
        role: inviteRole,
      },
    });
  };

  const { mutate: createInviteLinkRequest, isLoading: createInviteLinkLoading } = useMutation({
    mutationFn: createBaseInvitationLink,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invite-link-list'] });
    },
  });

  const createInviteLink = async () => {
    await createInviteLinkRequest({ baseId, createBaseInvitationLinkRo: { role: inviteRole } });
  };

  const filteredRoleStatic = useFilteredRoleStatic(role);

  return (
    <Invite
      disabledLink={!hasPermission(role, 'base|invite_link')}
      sendInviteEmail={sendInviteEmail}
      createInviteLink={createInviteLink}
      loading={{
        sendInviteEmail: updateCollaboratorLoading,
        createInviteLink: createInviteLinkLoading,
      }}
      roleSelect={
        <RoleSelect
          className="mx-1"
          value={inviteRole}
          options={filteredRoleStatic}
          onChange={(role) => setInviteRole(role as IBaseRole)}
        />
      }
    />
  );
};
