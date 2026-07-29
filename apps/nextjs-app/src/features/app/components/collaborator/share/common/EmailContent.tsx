import type { IBaseRole, IRole } from '@teable/core';
import { ChevronLeft, UserPlus, X } from '@teable/icons';
import { z } from '@teable/openapi';
import { Spin } from '@teable/ui-lib/base';
import { Button, Input } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useMemo, useRef, useState } from 'react';
import { CopyButton } from '@/features/app/components/CopyButton';
import { RoleSelect } from '../../../collaborator-manage/components/RoleSelect';
import type { IRoleStatic } from '../../../collaborator-manage/types';

export const EmailContent = ({
  defaultRole,
  isCreateLoading,
  filteredRoleStatic,
  onCreate,
  onBack,
  resourceUrl,
}: {
  defaultRole: IRole;
  isCreateLoading: boolean;
  onCreate: (ro: { emails: string[]; role: IBaseRole }) => Promise<void>;
  onBack: () => void;
  filteredRoleStatic: IRoleStatic[];
  resourceUrl: string;
}) => {
  const { t } = useTranslation('common');
  const [selectedRole, setSelectedRole] = useState<IRole>(defaultRole);
  const [email, setEmail] = useState<string>('');
  const [inviteEmails, setInviteEmails] = useState<string[]>([]);
  const [hasSentInvitation, setHasSentInvitation] = useState(false);
  const emailInputRef = useRef<HTMLInputElement>(null);

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

  const sendInvitation = async () => {
    try {
      await onCreate({
        emails: inviteEmails,
        role: selectedRole as IBaseRole,
      });
      setEmail('');
      setInviteEmails([]);
      setHasSentInvitation(true);
    } catch {
      // The shared request error handler owns the user-facing failure message.
    }
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
        {t('invite.dialog.tabEmail')}
      </Button>
      <div className="space-y-4">
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
        <div
          className="flex h-20 flex-1 cursor-text flex-wrap gap-1 overflow-y-auto rounded-md border bg-background p-2 text-sm transition-colors focus-within:border-primary hover:border-primary/30 focus-within:hover:border-primary"
          onClick={() => emailInputRef.current?.focus()}
        >
          {inviteEmails.map((email) => (
            <div
              key={email}
              className="flex h-6 items-center rounded-full border bg-secondary px-2 text-[13px]"
            >
              {email}
              <X
                className="ml-1 cursor-pointer hover:opacity-70"
                onClick={() => deleteEmail(email)}
              />
            </div>
          ))}
          <input
            ref={emailInputRef}
            className="h-6 flex-auto bg-background text-[13px] outline-none"
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
        <div className="flex items-center justify-between">
          <RoleSelect
            value={selectedRole}
            options={filteredRoleStatic}
            onChange={(role) => setSelectedRole(role as IBaseRole)}
          />
          <Button
            size="sm"
            className="text-sm font-normal"
            disabled={inviteEmails.length === 0 || isCreateLoading}
            onClick={sendInvitation}
          >
            {isCreateLoading ? <Spin className="size-4" /> : <UserPlus className="size-4" />}
            {t('invite.dialog.emailSend')}
          </Button>
        </div>
      </div>
      {hasSentInvitation && (
        <div className="space-y-2 border-t pt-4">
          <div className="space-y-1">
            <p className="text-sm font-medium">{t('invite.sendInvitationSuccess')}</p>
            <p className="text-xs text-muted-foreground">
              {t('invite.dialog.directAccessDescription')}
            </p>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <Input className="min-w-0 flex-1" value={resourceUrl} readOnly />
            <CopyButton text={resourceUrl} variant="outline" size="icon-sm" className="shrink-0" />
          </div>
        </div>
      )}
    </div>
  );
};
