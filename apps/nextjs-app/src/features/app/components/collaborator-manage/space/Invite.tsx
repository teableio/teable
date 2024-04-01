import { useMutation, useQueryClient } from '@tanstack/react-query';
import { SpaceRole, hasPermission } from '@teable/core';
import { X } from '@teable/icons';
import { createSpaceInvitationLink, emailSpaceInvitation } from '@teable/openapi';
import { ReactQueryKeys, useSpaceRoleStatic } from '@teable/sdk';
import { Button, cn } from '@teable/ui-lib';
import { map } from 'lodash';
import { Trans, useTranslation } from 'next-i18next';
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { RoleSelect } from './RoleSelect';
import { getRolesWithLowerPermissions } from './utils';

interface IInvite {
  className?: string;
  spaceId: string;
  role: SpaceRole;
}

export const Invite: React.FC<IInvite> = (props) => {
  const { className, spaceId, role } = props;
  const queryClient = useQueryClient();
  const { t } = useTranslation('common');

  const [inviteType, setInviteType] = useState<'link' | 'email'>('email');
  const [inviteRole, setInviteRole] = useState<SpaceRole>(role);
  const [email, setEmail] = useState<string>('');
  const [inviteEmails, setInviteEmails] = useState<string[]>([]);

  const { mutate: emailInvitation, isLoading: updateCollaboratorLoading } = useMutation({
    mutationFn: emailSpaceInvitation,
    onSuccess: async () => {
      await queryClient.invalidateQueries(ReactQueryKeys.spaceCollaboratorList(spaceId));
    },
  });

  const sendInviteEmail = async () => {
    await emailInvitation({
      spaceId,
      emailSpaceInvitationRo: {
        emails: inviteEmails.length ? inviteEmails : [email],
        role: inviteRole,
      },
    });
    initEmail();
  };

  const { mutate: createInviteLinkRequest, isLoading: createInviteLinkLoading } = useMutation({
    mutationFn: createSpaceInvitationLink,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invite-link-list'] });
    },
  });

  const createInviteLink = async () => {
    await createInviteLinkRequest({ spaceId, createSpaceInvitationLinkRo: { role: inviteRole } });
    setInviteRole(SpaceRole.Creator);
  };

  const changeInviteType = (inviteType: 'link' | 'email') => {
    initEmail();
    setInviteRole(SpaceRole.Creator);
    setInviteType(inviteType);
  };

  const initEmail = () => {
    setInviteEmails([]);
    setEmail('');
  };

  const emailInputChange = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.code === 'Backspace' && !email?.length) {
      setInviteEmails(inviteEmails.slice(0, inviteEmails.length - 1));
      return;
    }
    if (
      ['Space', 'Enter'].includes(e.code) &&
      email &&
      z.string().email().safeParse(email).success &&
      !inviteEmails.includes(email)
    ) {
      setEmail('');
      setInviteEmails(inviteEmails.concat(email));
      e.preventDefault();
    }
  };

  const deleteEmail = (email: string) => {
    setInviteEmails((inviteEmails) => inviteEmails.filter((inviteEmail) => email !== inviteEmail));
  };

  const spaceRoleStatic = useSpaceRoleStatic();
  const filterRoles = useMemo(
    () => map(getRolesWithLowerPermissions(role, spaceRoleStatic), 'role'),
    [role, spaceRoleStatic]
  );

  const isEmailInputValid = useMemo(() => z.string().email().safeParse(email).success, [email]);

  const EmailInvite = (
    <div>
      <div className="flex gap-2">
        <div className="flex max-h-64 min-h-8 flex-1 flex-wrap gap-1 overflow-y-auto rounded-md border border-input bg-background p-1 text-sm shadow-sm transition-colors">
          {inviteEmails.map((email) => (
            <div
              key={email}
              className="flex h-6 items-center rounded-full bg-muted px-2 text-xs text-muted-foreground"
            >
              {email}
              <X
                className="ml-1 cursor-pointer hover:opacity-70"
                onClick={() => deleteEmail(email)}
              />
            </div>
          ))}
          <input
            className="h-6 flex-auto bg-background text-xs outline-none"
            placeholder={t('invite.dialog.emailPlaceholder')}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={emailInputChange}
          />
        </div>
        <RoleSelect value={inviteRole} filterRoles={filterRoles} onChange={setInviteRole} />
      </div>
      <Button
        className="mt-2"
        size={'sm'}
        disabled={(!isEmailInputValid && inviteEmails.length === 0) || updateCollaboratorLoading}
        onClick={sendInviteEmail}
      >
        {t('invite.dialog.emailSend')}
      </Button>
    </div>
  );

  const LinkInvite = (
    <div>
      <div className="flex items-center text-sm">
        <Trans ns="common" i18nKey={'invite.dialog.linkPlaceholder'}>
          <RoleSelect
            className="mx-1"
            filterRoles={filterRoles}
            value={inviteRole}
            onChange={setInviteRole}
          />
        </Trans>
      </div>
      <Button
        className="mt-2"
        size={'sm'}
        disabled={createInviteLinkLoading}
        onClick={createInviteLink}
      >
        {t('invite.dialog.linkSend')}
      </Button>
    </div>
  );

  const showLink = hasPermission(role, 'space|invite_link');

  if (!showLink) {
    return <div className={cn(className, 'rounded bg-muted px-4 py-2')}>{EmailInvite}</div>;
  }

  return (
    <div className={cn(className, 'rounded bg-muted px-4 py-2')}>
      <div className="pb-2">
        <Button
          className="mr-6 p-0 data-[state=active]:underline"
          data-state={inviteType === 'email' ? 'active' : 'inactive'}
          variant={'link'}
          onClick={() => changeInviteType('email')}
        >
          {t('invite.dialog.tabEmail')}
        </Button>
        <Button
          className="p-0 data-[state=active]:underline"
          data-state={inviteType === 'link' ? 'active' : 'inactive'}
          variant={'link'}
          onClick={() => changeInviteType('link')}
        >
          {t('invite.dialog.tabLink')}
        </Button>
      </div>
      <div>{inviteType === 'email' ? EmailInvite : LinkInvite}</div>
    </div>
  );
};
