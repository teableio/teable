import type { IFieldVo, IRecord, IViewVo } from '@teable-group/core';
import { ViewProvider, FieldProvider, RecordProvider, useTable } from '@teable-group/sdk';
import { ErrorBoundary } from 'react-error-boundary';
import { useTitle } from 'react-use';
import { useIsHydrated } from '@/lib/use-is-hydrated';
import { ToolBar } from '../tool-bar/ToolBar';
import { GridView } from '../view/grid/GridView';
import { ViewList } from '../view/list/ViewList';
import { FailAlert } from './FailAlert';

export interface ITableProps {
  fieldServerData: IFieldVo[];
  viewServerData: IViewVo[];
  recordServerData: { records: IRecord[]; total: number };
}

export const Table: React.FC<ITableProps> = ({
  fieldServerData,
  viewServerData,
  recordServerData,
}) => {
  const isHydrated = useIsHydrated();
  const table = useTable();
  useTitle(`${table?.icon ? table.icon + ' ' : ''}${table?.name}`);
  return (
    <ViewProvider fallback={<h1>loading</h1>} serverData={viewServerData}>
      <div className="grow flex flex-col h-full">
        <ViewList />
        <FieldProvider fallback={<h1>🫙 Empty</h1>} serverSideData={fieldServerData}>
          <ToolBar />
          <RecordProvider serverData={recordServerData}>
            <ErrorBoundary
              fallback={
                <div className="w-full h-full flex justify-center items-center">
                  <FailAlert />
                </div>
              }
            >
              {isHydrated && <GridView />}
            </ErrorBoundary>
          </RecordProvider>
        </FieldProvider>
      </div>
    </ViewProvider>
  );
};
