import type { IFieldVo, IRecord, IViewVo } from '@teable-group/core';
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
import { SideBar } from './SideBar';

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
            <SideBar />
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
