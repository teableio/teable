import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SpaceRole } from '@teable/core';
import { Copy, X } from '@teable/icons';
import {
  deleteSpaceInvitationLink,
  listSpaceInvitationLink,
  updateSpaceInvitationLink,
} from '@teable/openapi';
import { useSpaceRoleStatic } from '@teable/sdk/hooks';
import {
  Button,
  Input,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  useToast,
} from '@teable/ui-lib';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { map } from 'lodash';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { RoleSelect } from './RoleSelect';
import { getRolesWithLowerPermissions } from './utils';
dayjs.extend(relativeTime);

interface IInviteLink {
  spaceId: string;
  role: SpaceRole;
}

export const InviteLink: React.FC<IInviteLink> = (props) => {
  const { spaceId, role } = props;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation('common');

  const linkList = useQuery({
    queryKey: ['invite-link-list', spaceId],
    queryFn: ({ queryKey }) => listSpaceInvitationLink(queryKey[1]),
  }).data?.data;

  const { mutate: updateInviteLink, isLoading: updateInviteLinkLoading } = useMutation({
    mutationFn: updateSpaceInvitationLink,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invite-link-list'] });
    },
  });

  const { mutate: deleteInviteLink, isLoading: deleteInviteLinkLoading } = useMutation({
    mutationFn: deleteSpaceInvitationLink,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invite-link-list'] });
    },
  });

  const copyInviteUrl = async (url: string) => {
    await navigator.clipboard.writeText(url);
    toast({ title: t('invite.dialog.linkCopySuccess') });
  };

  const spaceRoleStatic = useSpaceRoleStatic();
  const filterRoles = useMemo(
    () => map(getRolesWithLowerPermissions(role, spaceRoleStatic), 'role'),
    [role, spaceRoleStatic]
  );

  if (!linkList?.length) {
    return <></>;
  }

  return (
    <div>
      <div className="mb-3 text-sm text-muted-foreground">{t('invite.dialog.linkTitle')}</div>
      <div className="space-y-3">
        {linkList.map(({ invitationId, inviteUrl, createdTime, role }) => (
          <div key={invitationId} className="relative flex items-center gap-3 pr-7">
            <div className="flex flex-1 items-center gap-2">
              <Input className="h-8 flex-1" value={inviteUrl} readOnly />
              <Copy
                onClick={() => copyInviteUrl(inviteUrl)}
                className="size-4 cursor-pointer text-muted-foreground opacity-70 hover:opacity-100"
              />
            </div>
            <div className="text-xs text-muted-foreground">
              {t('invite.dialog.linkCreatedTime', { createdTime: dayjs(createdTime).fromNow() })}
            </div>
            <RoleSelect
              value={role}
              disabled={updateInviteLinkLoading}
              filterRoles={filterRoles}
              onChange={(role) =>
                updateInviteLink({ spaceId, invitationId, updateSpaceInvitationLinkRo: { role } })
              }
            />
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    className="absolute right-0 h-auto p-0 hover:bg-inherit"
                    size="sm"
                    variant="ghost"
                    disabled={deleteInviteLinkLoading}
                    onClick={() => deleteInviteLink({ spaceId, invitationId })}
                  >
                    <X className="size-4 cursor-pointer text-muted-foreground opacity-70 hover:opacity-100" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t('invite.dialog.linkRemove')}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        ))}
      </div>
    </div>
  );
};
