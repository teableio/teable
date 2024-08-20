import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { IRole } from '@teable/core';
import { hasPermission, Role } from '@teable/core';
import { createSpaceInvitationLink, emailSpaceInvitation } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useState } from 'react';
import { Invite } from '../components/Invite';
import { RoleSelect } from '../components/RoleSelect';
import { useFilteredRoleStatic } from './useFilteredRoleStatic';

export const SpaceInvite = (props: { spaceId: string; role: IRole }) => {
  const { role, spaceId } = props;
  const [inviteRole, setInviteRole] = useState<IRole>(role === Role.Owner ? Role.Creator : role);
  const queryClient = useQueryClient();

  const { mutate: emailInvitation, isLoading: updateCollaboratorLoading } = useMutation({
    mutationFn: emailSpaceInvitation,
    onSuccess: async () => {
      await queryClient.invalidateQueries(ReactQueryKeys.spaceCollaboratorList(spaceId));
    },
  });

  const sendInviteEmail = async (emails: string[]) => {
    emailInvitation({
      spaceId,
      emailSpaceInvitationRo: {
        emails,
        role: inviteRole,
      },
    });
  };

  const { mutate: createInviteLinkRequest, isLoading: createInviteLinkLoading } = useMutation({
    mutationFn: createSpaceInvitationLink,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invite-link-list'] });
    },
  });

  const createInviteLink = async () => {
    await createInviteLinkRequest({ spaceId, createSpaceInvitationLinkRo: { role: inviteRole } });
  };

  const filteredRoleStatic = useFilteredRoleStatic(role);

  return (
    <Invite
      disabledLink={!hasPermission(role, 'space|invite_link')}
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
          onChange={(role) => setInviteRole(role)}
        />
      }
    />
  );
};
