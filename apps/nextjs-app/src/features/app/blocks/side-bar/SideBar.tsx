import { Bell, Home, PackageCheck } from '@teable-group/icons';
import { Button } from '@teable-group/ui-lib/shadcn/ui/button';
import { Input } from '@teable-group/ui-lib/shadcn/ui/input';
import Link from 'next/link';
import { TableList } from '../table-list/TableList';
import { SideBarFooter } from './SideBarFooter';
import { SideBarHeader } from './SideBarHeader';

export const SideBar: React.FC = () => {
  return (
    <div className="flex h-full flex-col overflow-hidden basis-[300px]">
      <SideBarHeader />

      <div className="divide-base-300 divide-y divide-solid flex flex-col overflow-hidden py-2 gap-2">
        <div className="flex flex-col gap-2 px-3">
          <div>
            <Input className="h-8" type="text" placeholder="Search" />
          </div>
          <ul>
            <li>
              <Button
                variant="ghost"
                size={'xs'}
                asChild
                className="w-full justify-start text-sm px-2"
              >
                <Link href="/space" className="font-normal">
                  <Home className="h-4 w-4 shrink-0" />
                  <p className="overflow-hidden text-ellipsis whitespace-nowrap">Home</p>
                  <div className="grow basis-0"></div>
                  <p className="text-xs text-slate-500">⌘H︎</p>
                </Link>
              </Button>
            </li>
            <li>
              <Button
                variant="ghost"
                size={'xs'}
                asChild
                className="w-full justify-start text-sm px-2"
              >
                <Link className="py-1 font-normal" href="/space/dashboard">
                  <Bell className="h-4 w-4 shrink-0" />
                  <p className="overflow-hidden text-ellipsis whitespace-nowrap">Notification</p>
                  <div className="grow basis-0"></div>
                  <p className="text-xs text-slate-500">⌘T</p>
                </Link>
              </Button>
            </li>
            <li>
              <Button
                variant="ghost"
                size={'xs'}
                asChild
                className="w-full justify-start text-sm px-2"
              >
                <a className="py-1 font-normal">
                  <PackageCheck className="h-4 w-4 shrink-0" />
                  <p className="overflow-hidden text-ellipsis whitespace-nowrap">Automation</p>
                  <div className="grow basis-0"></div>
                  <p className="text-xs text-slate-500">⌘A</p>
                </a>
              </Button>
            </li>
          </ul>
        </div>
        <TableList />
      </div>
      <div className="grow basis-0"></div>
      <SideBarFooter />
    </div>
  );
};
