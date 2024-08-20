import { X } from '@teable/icons';
import { Button, cn } from '@teable/ui-lib';
import { Trans, useTranslation } from 'next-i18next';
import { useMemo, useState } from 'react';
import { z } from 'zod';

interface IInvite {
  className?: string;
  disabledLink?: boolean;
  loading: {
    sendInviteEmail?: boolean;
    createInviteLink?: boolean;
  };
  roleSelect: React.ReactNode;
  sendInviteEmail: (emails: string[]) => Promise<void>;
  createInviteLink: () => Promise<void>;
}

export const Invite = (props: IInvite) => {
  const { className, disabledLink, loading, roleSelect, sendInviteEmail, createInviteLink } = props;
  const { t } = useTranslation('common');

  const [inviteType, setInviteType] = useState<'link' | 'email'>('email');
  const [email, setEmail] = useState<string>('');
  const [inviteEmails, setInviteEmails] = useState<string[]>([]);

  const innerSendInviteEmail = async () => {
    await sendInviteEmail(inviteEmails);
    initEmail();
  };

  const innerCreateInviteLink = async () => {
    await createInviteLink();
  };

  const changeInviteType = (inviteType: 'link' | 'email') => {
    initEmail();
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
            onBlur={() => {
              if (isEmailInputValid) {
                setInviteEmails(inviteEmails.concat(email));
                setEmail('');
              }
            }}
            onKeyDown={emailInputChange}
          />
        </div>
        {roleSelect}
      </div>
      <Button
        className="mt-2"
        size={'sm'}
        disabled={(!isEmailInputValid && inviteEmails.length === 0) || loading.sendInviteEmail}
        onClick={innerSendInviteEmail}
      >
        {t('invite.dialog.emailSend')}
      </Button>
    </div>
  );

  const LinkInvite = (
    <div>
      <div className="flex items-center text-sm">
        <Trans ns="common" i18nKey={'invite.dialog.linkPlaceholder'}>
          {roleSelect}
        </Trans>
      </div>
      <Button
        className="mt-2"
        size={'sm'}
        disabled={loading.createInviteLink}
        onClick={innerCreateInviteLink}
      >
        {t('invite.dialog.linkSend')}
      </Button>
    </div>
  );

  if (disabledLink) {
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
