import { Github, Settings } from '@teable-group/icons';
import { useSession } from '@teable-group/sdk';
import { Avatar, AvatarFallback, AvatarImage, Button } from '@teable-group/ui-lib/shadcn';
import React from 'react';
import { NotificationsManage } from '@/features/app/components/notifications/NotificationsManage';
import { SettingTrigger } from './setting/SettingTrigger';
import { UserNav } from './user/UserNav';

export const SideBarFooter: React.FC = () => {
  const { user } = useSession();

  return (
    <div className="mx-2 mb-1 flex flex-col items-center gap-1">
      <div className="flex w-full justify-between">
        <UserNav>
          <Button variant="ghost" size={'xs'} className="w-full justify-start text-sm font-normal">
            <Avatar className="h-7 w-7">
              <AvatarImage src={user.avatar as string} alt="avatar-name" />
              <AvatarFallback>{user.name.slice(0, 1)}</AvatarFallback>
            </Avatar>
            {user.name}
            <div className="grow basis-0"></div>
          </Button>
        </UserNav>
        <NotificationsManage />
      </div>
      <SettingTrigger>
        <Button variant="ghost" size={'xs'} className="w-full justify-start text-sm font-normal">
          <Settings className="h-5 w-5 shrink-0" />
          Settings
          <div className="grow basis-0"></div>
          <p className="text-xs text-slate-500">10.2k</p>
          <Github className="h-4 w-4 shrink-0" />
        </Button>
      </SettingTrigger>
    </div>
  );
};
