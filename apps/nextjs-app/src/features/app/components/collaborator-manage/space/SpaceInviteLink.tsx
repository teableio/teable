import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IRole } from '@teable/core';
import {
  deleteSpaceInvitationLink,
  listSpaceInvitationLink,
  updateSpaceInvitationLink,
} from '@teable/openapi';
import { useTranslation } from 'next-i18next';
import { InviteLinkItem } from '../components/InviteLinkItem';
import { RoleSelect } from '../components/RoleSelect';
import { useFilteredRoleStatic } from './useFilteredRoleStatic';

export const SpaceInviteLink = (props: { spaceId: string; role: IRole }) => {
  const { spaceId, role } = props;
  const queryClient = useQueryClient();
  const { t } = useTranslation('common');

  const linkList = useQuery({
    queryKey: ['invite-link-list', spaceId],
    queryFn: ({ queryKey }) => listSpaceInvitationLink(queryKey[1]).then((res) => res.data),
  }).data;

  const { mutate: updateInviteLink, isLoading: updateInviteLinkLoading } = useMutation({
    mutationFn: updateSpaceInvitationLink,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invite-link-list'] });
    },
  });

  const onUpdateInviteLink = async (invitationId: string, role: IRole) => {
    updateInviteLink({
      invitationId,
      updateSpaceInvitationLinkRo: { role },
      spaceId,
    });
  };

  const { mutate: deleteInviteLink, isLoading: deleteInviteLinkLoading } = useMutation({
    mutationFn: deleteSpaceInvitationLink,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invite-link-list'] });
    },
  });

  const onDeleteInviteLink = async (invitationId: string) => {
    deleteInviteLink({ invitationId, spaceId });
  };

  const filteredRoleStatic = useFilteredRoleStatic(role);

  if (!linkList?.length) {
    return <></>;
  }

  return (
    <div>
      <div className="mb-3 text-sm text-muted-foreground">{t('invite.dialog.linkTitle')}</div>
      <div className="space-y-3">
        {linkList.map(({ invitationId, inviteUrl, createdTime, role }) => (
          <InviteLinkItem
            key={invitationId}
            url={inviteUrl}
            createdTime={createdTime}
            onDelete={() => onDeleteInviteLink(invitationId)}
            deleteDisabled={deleteInviteLinkLoading}
          >
            <RoleSelect
              value={role}
              options={filteredRoleStatic}
              disabled={updateInviteLinkLoading}
              onChange={(role) => onUpdateInviteLink(invitationId, role)}
            />
          </InviteLinkItem>
        ))}
      </div>
    </div>
  );
};
