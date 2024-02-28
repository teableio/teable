import { useSession } from '@teable/sdk';
import { Avatar, AvatarFallback, AvatarImage, Button } from '@teable/ui-lib/shadcn';
import React from 'react';
import { NotificationsManage } from '@/features/app/components/notifications/NotificationsManage';
import { DuplicateBaseModal } from '../blocks/base/base-side-bar/duplicate/DuplicateBaseModal';
import { SettingDialog } from './setting/SettingDialog';
import { UserNav } from './user/UserNav';

export const SideBarFooter: React.FC = () => {
  const { user } = useSession();

  return (
    <div className="m-2 flex flex-col items-center gap-1">
      <div className="flex w-full justify-between">
        <UserNav>
          <Button variant="ghost" size={'xs'} className="w-full justify-start text-sm font-normal">
            <Avatar className="size-7">
              <AvatarImage src={user.avatar as string} alt="avatar-name" />
              <AvatarFallback>{user.name.slice(0, 1)}</AvatarFallback>
            </Avatar>
            {user.name}
          </Button>
        </UserNav>
        <SettingDialog />
        <DuplicateBaseModal />
        <NotificationsManage />
      </div>
    </div>
  );
};
