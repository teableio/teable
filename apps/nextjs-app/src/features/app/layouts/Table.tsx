import type { IFieldVo, IRecord, IViewVo } from '@teable-group/core';
import {
  TableProvider,
  ViewProvider,
  FieldProvider,
  RecordProvider,
  AppProvider,
} from '@teable-group/sdk';
import FavoriteIcon from '@teable-group/ui-lib/icons/app/favorite.svg';
import HomeIcon from '@teable-group/ui-lib/icons/app/home.svg';
import Image from 'next/image';
import { GridView } from '../blocks/view/grid/GridView';
import { ViewList } from '../blocks/view/list/ViewList';
import { AppLayout } from './AppLayout';

export interface ITableProps {
  tableId: string;
  fieldServerData: IFieldVo[];
  viewServerData: IViewVo[];
  recordServerData: { records: IRecord[]; total: number };
}

export const Table: React.FC<ITableProps> = ({
  tableId,
  fieldServerData,
  viewServerData,
  recordServerData,
}) => {
  return (
    <AppLayout>
      <AppProvider>
        <TableProvider tableId={tableId} fallback={<h1>loading</h1>}>
          <div id="portal" className="h-screen flex items-start w-full">
            <div className="max-w-xs h-full w-56 overflow-y-auto border-r">
              <div className="mx-2 my-4">
                <Image
                  width={32}
                  height={32}
                  loading={'eager'}
                  src={'/shared-assets/images/teable-red.png'}
                  alt={'tailwind-ui-logo'}
                  className="rounded object-cover object-center inline-block"
                />
                <span className="px-1 font-bold">Teable</span>
              </div>
              <div className="divide-y divide-dashed">
                <div>
                  <div className="m-2">
                    <input
                      type="text"
                      placeholder="Search"
                      className="input input-bordered input-xs w-full max-w-xs"
                    />
                  </div>
                  <ul className="menu py-2">
                    <li>
                      <a className="py-1">
                        <HomeIcon /> Home
                      </a>
                    </li>
                    <li>
                      <a className="py-1">
                        <FavoriteIcon /> Favorites
                      </a>
                    </li>
                  </ul>
                </div>
                <ul className="menu menu-compact py-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <li key={i}>
                      <a className="py-1">Table {i + 1}</a>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <ViewProvider fallback={<h1>loading</h1>} serverData={viewServerData}>
              <div className="grow flex flex-col h-full">
                <ViewList />
                <FieldProvider fallback={<h1>loading</h1>} serverSideData={fieldServerData}>
                  <RecordProvider serverData={recordServerData}>
                    <GridView />
                  </RecordProvider>
                </FieldProvider>
              </div>
            </ViewProvider>
          </div>
        </TableProvider>
      </AppProvider>
    </AppLayout>
  );
};
