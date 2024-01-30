import { useSession } from '@teable-group/sdk';
import { Avatar, AvatarFallback, AvatarImage, Button } from '@teable-group/ui-lib/shadcn';
import React from 'react';
import { NotificationsManage } from '@/features/app/components/notifications/NotificationsManage';
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
        <NotificationsManage />
      </div>
    </div>
  );
};
