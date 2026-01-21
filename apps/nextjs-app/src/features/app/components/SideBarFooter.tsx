import { useSession } from '@teable/sdk';
import { useIsAnonymous, useIsTemplate } from '@teable/sdk/hooks';
import { Button } from '@teable/ui-lib/shadcn';
import Link from 'next/link';
import { Trans } from 'next-i18next';
import React from 'react';
import { TeableLogo } from '@/components/TeableLogo';
import { NotificationsManage } from '@/features/app/components/notifications/NotificationsManage';
import { UserAvatar } from '@/features/app/components/user/UserAvatar';
import { SettingDialog } from '@overridable/SettingDialog';
import { DuplicateBaseModal } from '../blocks/base/duplicate/DuplicateBaseModal';
import { TemplateCreateBaseModal } from '../blocks/base/duplicate/TemplateCreateBaseModal';
import { SpaceSubscriptionModal } from '../blocks/billing/SpaceSubscriptionModal';
import { useBrand } from '../hooks/useBrand';
import { PublicOperateButton } from './PublicOperateButton';
import { UserNav } from './user/UserNav';

export const SideBarFooter: React.FC = () => {
  const { user } = useSession();
  const isAnonymous = useIsAnonymous();
  const isTemplate = useIsTemplate();
  const { brandName } = useBrand();

  if (isAnonymous || isTemplate) {
    return (
      <div className="mx-4 my-3 flex flex-col items-center gap-4">
        <PublicOperateButton />
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Trans
            ns="common"
            i18nKey="poweredBy"
            components={[
              <Link
                key={'brandFooter'}
                href="/"
                target="_blank"
                className="flex items-center text-sm text-black dark:text-white"
              >
                <TeableLogo className="text-xl" />
                <span className="ml-1 font-semibold">{brandName}</span>
              </Link>,
            ]}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col items-center gap-2 p-2">
      <div className="flex w-full justify-between gap-2">
        <UserNav>
          <Button
            variant="ghost"
            size={'sm'}
            className="min-w-0 flex-1 justify-start overflow-hidden py-1.5 pl-2 text-sm font-normal"
          >
            <UserAvatar className="border" user={user} />
            <p className="truncate" title={user.name}>
              {user.name}
            </p>
          </Button>
        </UserNav>
        <SettingDialog />
        <DuplicateBaseModal />
        <TemplateCreateBaseModal />
        <SpaceSubscriptionModal />
        <NotificationsManage />
      </div>
    </div>
  );
};
