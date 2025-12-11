import { useSession } from '@teable/sdk';
import { Button } from '@teable/ui-lib/shadcn';
import React from 'react';
import { NotificationsManage } from '@/features/app/components/notifications/NotificationsManage';
import { UserAvatar } from '@/features/app/components/user/UserAvatar';
import { DuplicateBaseModal } from '../blocks/base/duplicate/DuplicateBaseModal';
import { TemplateCreateBaseModal } from '../blocks/base/duplicate/TemplateCreateBaseModal';
import { SpaceSubscriptionModal } from '../blocks/billing/SpaceSubscriptionModal';
import { SettingDialog } from './setting/SettingDialog';
import { UserNav } from './user/UserNav';

export const SideBarFooter: React.FC = () => {
  const { user } = useSession();

  return (
    <div className="m-2 flex flex-col items-center gap-2">
      <div className="flex w-full justify-between gap-2">
        <UserNav>
          <Button
            variant="ghost"
            size={'sm'}
            className="w-full justify-start py-1.5 pl-2 text-sm font-normal"
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
