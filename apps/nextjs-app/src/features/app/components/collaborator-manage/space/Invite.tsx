import { useMutation, useQueryClient } from '@tanstack/react-query';
import { SpaceRole } from '@teable-group/core';
import { X } from '@teable-group/icons';
import { createSpaceInvitationLink, emailSpaceInvitation } from '@teable-group/openapi';
import { Button } from '@teable-group/ui-lib';
import classNames from 'classnames';
import { useState } from 'react';
import { z } from 'zod';
import { RoleSelect } from './RoleSelect';

interface IInvite {
  className?: string;
  spaceId: string;
}

export const Invite: React.FC<IInvite> = (props) => {
  const { className, spaceId } = props;
  const queryClient = useQueryClient();

  const [inviteType, setInviteType] = useState<'link' | 'email'>('email');
  const [inviteRole, setInviteRole] = useState<SpaceRole>(SpaceRole.Creator);
  const [email, setEmail] = useState<string>('');
  const [inviteEmails, setInviteEmails] = useState<string[]>([]);

  const { mutate: emailInvitation, isLoading: updateCollaboratorLoading } = useMutation({
    mutationFn: emailSpaceInvitation,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['space-collaborator-list'] });
    },
  });

  const sendInviteEmail = async () => {
    await emailInvitation({
      spaceId,
      emailSpaceInvitationRo: { emails: inviteEmails, role: inviteRole },
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

  const EmailInvite = (
    <div>
      <div className="flex gap-2">
        <div className="flex max-h-64 min-h-[2rem] flex-1 flex-wrap gap-1 overflow-y-auto rounded-md border border-input bg-background p-1 text-sm shadow-sm transition-colors">
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
            placeholder="Invite more workspace collaborators via email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={emailInputChange}
          />
        </div>
        <RoleSelect value={inviteRole} onChange={setInviteRole} />
      </div>
      <Button
        className="mt-2"
        size={'sm'}
        disabled={inviteEmails.length === 0 || updateCollaboratorLoading}
        onClick={sendInviteEmail}
      >
        Send invite
      </Button>
    </div>
  );

  const LinkInvite = (
    <div>
      <div className="flex items-center text-sm">
        Create an invite link that grants
        <RoleSelect className="mx-1" value={inviteRole} onChange={setInviteRole} />
        access to anyone who opens it.
      </div>
      <Button
        className="mt-2"
        size={'sm'}
        disabled={createInviteLinkLoading}
        onClick={createInviteLink}
      >
        Create link
      </Button>
    </div>
  );

  return (
    <div className={classNames(className, 'rounded bg-muted px-4 py-2')}>
      <div className="pb-2">
        <Button
          className="mr-6 p-0 data-[state=active]:underline"
          data-state={inviteType === 'email' ? 'active' : 'inactive'}
          variant={'link'}
          onClick={() => changeInviteType('email')}
        >
          invite by email
        </Button>
        <Button
          className="p-0 data-[state=active]:underline"
          data-state={inviteType === 'link' ? 'active' : 'inactive'}
          variant={'link'}
          onClick={() => changeInviteType('link')}
        >
          invite by link
        </Button>
      </div>
      <div>{inviteType === 'email' ? EmailInvite : LinkInvite}</div>
    </div>
  );
};
