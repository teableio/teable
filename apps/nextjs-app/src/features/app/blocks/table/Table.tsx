import type { IFieldVo, IRecord, IViewVo } from '@teable-group/core';
import {
  ViewProvider,
  FieldProvider,
  RecordProvider,
  useTable,
  AnchorContext,
} from '@teable-group/sdk';
import { useRouter } from 'next/router';
import { ErrorBoundary } from 'react-error-boundary';
import { useTitle } from 'react-use';
import { useIsHydrated } from '@/lib/use-is-hydrated';
import { FailAlert } from '../table-list/FailAlert';
import { ToolBar } from '../tool-bar/ToolBar';
import { GridView } from '../view/grid/GridView';
import { TableHeader } from './table-header/TableHeader';

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
  useTitle(table?.name ? `${table?.icon ? table.icon + ' ' : ''}${table.name}` : 'Teable');
  const router = useRouter();
  const { nodeId, viewId } = router.query;
  return (
    <AnchorContext.Provider value={{ tableId: nodeId as string, viewId: viewId as string }}>
      <ViewProvider serverData={viewServerData}>
        <div className="grow flex flex-col h-full basis-[500px]">
          <TableHeader />
          <FieldProvider serverSideData={fieldServerData}>
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
    </AnchorContext.Provider>
  );
};
