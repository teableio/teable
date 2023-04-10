import { useConnection } from '@teable-group/sdk/hooks';
import FavoriteIcon from '@teable-group/ui-lib/icons/app/favorite.svg';
import HomeIcon from '@teable-group/ui-lib/icons/app/home.svg';
import Image from 'next/image';
import Link from 'next/link';
import { useIsHydrated } from '@/lib/use-is-hydrated';
import { TableList } from '../blocks/table/TableList';
import { ThemePicker } from './ThemePicker';

export const SideBar: React.FC = () => {
  const isHydrated = useIsHydrated();
  const { connected } = useConnection();

  return (
    <div className="h-full overflow-y-auto w-full">
      <div className="mx-2 my-4">
        <Image
          width={32}
          height={32}
          loading={'eager'}
          src={'/shared-assets/images/teable-logo.png'}
          alt={'tailwind-ui-logo'}
          className="rounded object-cover object-center inline-block"
        />
        <span className="px-1">teable</span>
        {isHydrated && <ThemePicker />}
        {!connected && <button className="btn btn-xs btn-ghost loading"></button>}
      </div>

      <div className="divide-y divide-solid divide-base-300">
        <div>
          <div className="m-2">
            <input
              type="text"
              placeholder="Search"
              className="input input-bordered input-xs w-full"
            />
          </div>
          <ul className="menu py-2">
            <li>
              <Link className="py-1" href="/space">
                <HomeIcon /> Home
              </Link>
            </li>
            <li>
              <a className="py-1">
                <FavoriteIcon /> Favorites
              </a>
            </li>
          </ul>
        </div>
        <TableList />
      </div>
    </div>
  );
};
