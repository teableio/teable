import { Bell, Home, Users } from '@teable-group/icons';
import { cn } from '@teable-group/ui-lib/shadcn';
import { Button } from '@teable-group/ui-lib/shadcn/ui/button';
import { Input } from '@teable-group/ui-lib/shadcn/ui/input';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { SpaceList } from './SpaceList';

export const SpaceSideBar = () => {
  const router = useRouter();

  const pageRoutes: {
    href: string;
    text: string;
    shortCutKey: string;
    Icon: React.FC<{ className?: string }>;
  }[] = [
    {
      href: '/space',
      text: 'Home',
      shortCutKey: '⌘H',
      Icon: Home,
    },
    {
      href: '/space/notification',
      text: 'Notification',
      shortCutKey: '⌘T',
      Icon: Bell,
    },
    {
      href: '/space/Member',
      text: 'Member',
      shortCutKey: '⌘A',
      Icon: Users,
    },
  ];
  return (
    <>
      <div className="flex flex-col gap-2 px-3">
        <div>
          <Input className="h-8" type="text" placeholder="Search" />
        </div>
        <ul>
          {pageRoutes.map(({ href, text, shortCutKey, Icon }) => {
            return (
              <li key={href}>
                <Button
                  variant="ghost"
                  size={'xs'}
                  asChild
                  className={cn(
                    'w-full justify-start text-sm px-2 my-[2px]',
                    href === router.pathname && 'bg-secondary'
                  )}
                >
                  <Link href={href} className="font-normal">
                    <Icon className="h-4 w-4 shrink-0" />
                    <p className="truncate">{text}</p>
                    <div className="grow basis-0"></div>
                    <p className="text-xs text-slate-500">{shortCutKey}</p>
                  </Link>
                </Button>
              </li>
            );
          })}
        </ul>
      </div>
      <SpaceList />
    </>
  );
};
