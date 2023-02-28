import type { IFieldVo } from '@teable-group/core';
import {
  TableProvider,
  ViewProvider,
  FieldProvider,
  RecordProvider,
  AppProvider,
} from '@teable-group/sdk';

import { GridView } from '../blocks/view/grid/GridView';
import { ViewList } from '../blocks/view/list/ViewList';
import { AppLayout } from './AppLayout';

export interface ITableProps {
  tableId: string;
  fieldServerData?: IFieldVo;
}

export const Table: React.FC<ITableProps> = ({ tableId }) => {
  return (
    <AppLayout>
      <AppProvider>
        <TableProvider tableId={tableId} fallback={<h1>loading</h1>}>
          <div id="portal" className="h-screen flex items-start w-full">
            <div className="max-w-xs w-full h-full bg-base-200 overflow-y-auto">
              Teable Technical Preview
            </div>
            <ViewProvider fallback={<h1>loading</h1>}>
              <div className="grow flex flex-col h-full">
                <ViewList />
                <FieldProvider fallback={<h1>loading</h1>}>
                  <RecordProvider>
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
