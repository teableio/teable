import { Home, ArrowUpRight } from '@teable/icons';
import { useSession } from '@teable/sdk/hooks';
import { Button, Separator } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import React from 'react';
import { UserAvatar } from '@/features/app/components/user/UserAvatar';
import { UserNav } from '../../components/user/UserNav';

interface ISettingRight {
  title?: string | React.ReactNode;
  children: React.ReactNode;
}

export const SettingRight = (props: ISettingRight) => {
  const { title, children } = props;
  const router = useRouter();
  const { user } = useSession();
  const { t } = useTranslation('common');
  return (
    <div className="flex h-full flex-1 flex-col">
      <div className="flex h-20 items-center gap-4">
        <h2 className="flex-1 text-base">{title}</h2>
        <Button variant="link" asChild>
          <a href={t('help.apiLink')} target="_blank" rel="noreferrer">
            <ArrowUpRight /> {t('help.devDocs')}
          </a>
        </Button>

        <Button variant={'ghost'} onClick={() => router.push('/')}>
          <Home />
          {t('settings.back')}
        </Button>
        <UserNav>
          <UserAvatar user={user} />
        </UserNav>
      </div>
      <Separator />
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
};
