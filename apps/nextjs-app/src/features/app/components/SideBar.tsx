import { useConnection } from '@teable-group/sdk/hooks';
import DashboardIcon from '@teable-group/ui-lib/icons/app/dashboard.svg';
import FavoriteIcon from '@teable-group/ui-lib/icons/app/favorite.svg';
import HomeIcon from '@teable-group/ui-lib/icons/app/home.svg';
import Image from 'next/image';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useIsHydrated } from '@/lib/use-is-hydrated';
import { TableList } from '../blocks/table-list/TableList';
import { ThemePicker } from './ThemePicker';

export const SideBar: React.FC = () => {
  const isHydrated = useIsHydrated();
  const { connected } = useConnection();

  return (
    <div className="h-full w-full flex flex-col overflow-hidden">
      <div className="mx-2 my-4 space-x-2">
        <Image
          width={32}
          height={32}
          loading={'eager'}
          src={'/shared-assets/images/teable-logo.png'}
          alt={'tailwind-ui-logo'}
          className="rounded object-cover object-center inline-block"
        />
        <span>teable</span>
        {isHydrated && <ThemePicker />}
        {!connected && (
          <button className="ml-2 align-middle">
            <svg className="animate-spin h-5 w-5 mr-3" viewBox="0 0 24 24">
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              ></path>
            </svg>
          </button>
        )}
      </div>

      <div className="divide-base-300 divide-y divide-solid flex flex-col overflow-hidden">
        <div>
          <div className="m-2">
            <Input className="h-8" type="text" placeholder="Search" />
          </div>
          <ul className="space-y-1 py-2">
            <li>
              <Button variant="ghost" asChild className="w-full justify-start rounded-none">
                <Link href="/space" className="font-normal">
                  <HomeIcon className="mr-2 h-4 w-4" /> Home
                </Link>
              </Button>
            </li>
            <li>
              <Button variant="ghost" asChild className="w-full justify-start rounded-none">
                <Link className="py-1 font-normal" href="/space/dashboard">
                  <DashboardIcon className="mr-2 h-4 w-4" /> Dashboard
                </Link>
              </Button>
            </li>
            <li>
              <Button variant="ghost" asChild className="w-full justify-start rounded-none">
                <a className="py-1 font-normal">
                  <FavoriteIcon className="mr-2 h-4 w-4" /> Favorites
                </a>
              </Button>
            </li>
          </ul>
        </div>
        <TableList />
      </div>
    </div>
  );
};
