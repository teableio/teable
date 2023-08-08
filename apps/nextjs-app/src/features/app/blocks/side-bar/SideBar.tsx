import { Bell, Gauge, Home, PackageCheck } from '@teable-group/icons';
import { cn } from '@teable-group/ui-lib/shadcn';
import { Button } from '@teable-group/ui-lib/shadcn/ui/button';
import { Input } from '@teable-group/ui-lib/shadcn/ui/input';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { TableList } from '../table-list/TableList';
import { SideBarFooter } from './SideBarFooter';
import { SideBarHeader } from './SideBarHeader';

export const SideBar: React.FC = () => {
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
      href: '/space/dashboard',
      text: 'Dashboard',
      shortCutKey: '⌘D',
      Icon: Gauge,
    },
    {
      href: '/space/notification',
      text: 'Notification',
      shortCutKey: '⌘T',
      Icon: Bell,
    },
    {
      href: '/space/automation',
      text: 'Automation',
      shortCutKey: '⌘A',
      Icon: PackageCheck,
    },
  ];
  return (
    <div className="flex h-full flex-col overflow-hidden basis-[300px]">
      <SideBarHeader />

      <div className="divide-base-300 divide-y divide-solid flex flex-col overflow-hidden py-2 gap-2">
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
                      <p className="overflow-hidden text-ellipsis whitespace-nowrap">{text}</p>
                      <div className="grow basis-0"></div>
                      <p className="text-xs text-slate-500">{shortCutKey}</p>
                    </Link>
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
        <TableList />
      </div>
      <div className="grow basis-0"></div>
      <SideBarFooter />
    </div>
  );
};
