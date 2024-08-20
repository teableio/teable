import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IBaseRole, IRole } from '@teable/core';
import {
  deleteBaseInvitationLink,
  listBaseInvitationLink,
  updateBaseInvitationLink,
} from '@teable/openapi';
import { useTranslation } from 'next-i18next';
import { InviteLinkItem } from '../components/InviteLinkItem';
import { RoleSelect } from '../components/RoleSelect';
import { useFilteredRoleStatic } from './useFilteredRoleStatic';

export const BaseInviteLink = (props: { baseId: string; role: IRole }) => {
  const { baseId, role } = props;
  const queryClient = useQueryClient();
  const { t } = useTranslation('common');

  const linkList = useQuery({
    queryKey: ['invite-link-list', baseId],
    queryFn: ({ queryKey }) => listBaseInvitationLink(queryKey[1]).then((res) => res.data),
  }).data;

  const { mutate: updateInviteLink, isLoading: updateInviteLinkLoading } = useMutation({
    mutationFn: updateBaseInvitationLink,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invite-link-list'] });
    },
  });

  const onUpdateInviteLink = async (invitationId: string, role: IBaseRole) => {
    updateInviteLink({
      invitationId,
      updateBaseInvitationLinkRo: { role },
      baseId,
    });
  };

  const { mutate: deleteInviteLink, isLoading: deleteInviteLinkLoading } = useMutation({
    mutationFn: deleteBaseInvitationLink,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invite-link-list'] });
    },
  });

  const onDeleteInviteLink = async (invitationId: string) => {
    deleteInviteLink({ invitationId, baseId });
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
              onChange={(role) => onUpdateInviteLink(invitationId, role as IBaseRole)}
            />
          </InviteLinkItem>
        ))}
      </div>
    </div>
  );
};
