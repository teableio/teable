import { Github, Settings, UserPlus } from '@teable-group/icons';
import { useSession } from '@teable-group/sdk';
import { Avatar, AvatarFallback, Button } from '@teable-group/ui-lib/shadcn';
import { SettingTrigger } from './setting/SettingTrigger';
import { UserNav } from './user/UserNav';

export const SideBarFooter: React.FC = () => {
  const { user } = useSession();

  return (
    <div className="mx-2 mb-1 flex flex-col items-center gap-1">
      <UserNav>
        <Button variant="ghost" size={'xs'} className="w-full justify-start text-sm font-normal">
          <Avatar className="h-7 w-7">
            <AvatarFallback>{user.name.slice(0, 1)}</AvatarFallback>
          </Avatar>
          {user.name}
          <div className="grow basis-0"></div>
          <p className="text-xs text-slate-500">Invite Users</p>
          <UserPlus className="h-4 w-4 shrink-0" />
        </Button>
      </UserNav>
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
