import { TeableNew, HelpCircle } from '@teable/icons';
import { useSession } from '@teable/sdk';
import { Button } from '@teable/ui-lib';
import { useTranslation } from 'next-i18next';
import React, { type FC } from 'react';
import { UserAvatar } from '@/features/app/components/user/UserAvatar';
import { UserNav } from '@/features/app/components/user/UserNav';
import { webhookConfig } from '@/features/i18n/webhook.config';

export const SpaceSettingSideHead: FC = () => {
  const { t } = useTranslation(webhookConfig.i18nNamespaces);
  const { user } = useSession();

  return (
    <div className="flex min-h-16 w-full items-center justify-between border-b border-slate-200 px-5">
      <div className="flex items-center">
        <TeableNew className="text-4xl text-black" />
        <p className="ml-1 truncate text-3xl font-semibold">Teable</p>
      </div>
      <div className="flex items-center gap-4">
        <Button asChild variant="ghost" size="xs" className="hidden sm:flex">
          <a href={t('help.mainLink')} title="Help" target="_blank" rel="noreferrer">
            <HelpCircle className="size-4" />
            {t('help.title')}
          </a>
        </Button>
        <UserNav>
          <UserAvatar user={user} />
        </UserNav>
      </div>
    </div>
  );
};
