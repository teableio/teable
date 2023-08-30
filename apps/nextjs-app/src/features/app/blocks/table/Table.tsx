import type { IFieldVo, IRecord, IViewVo } from '@teable-group/core';
import {
  AggregationProvider,
  AnchorContext,
  FieldProvider,
  RecordProvider,
  useTable,
  ViewProvider,
} from '@teable-group/sdk';
import { RowCountProvider } from '@teable-group/sdk/context/aggregation/RowCountProvider';
import { useRouter } from 'next/router';
import { ErrorBoundary } from 'react-error-boundary';
import { useTitle } from 'react-use';
import { FailAlert } from '../table-list/FailAlert';
import { ToolBar } from '../tool-bar/ToolBar';
import { View } from '../view/View';
import { TableHeader } from './table-header/TableHeader';

export interface ITableProps {
  fieldServerData: IFieldVo[];
  viewServerData: IViewVo[];
  recordsServerData: { records: IRecord[] };
  recordServerData?: IRecord;
}

export const Table: React.FC<ITableProps> = ({
  fieldServerData,
  viewServerData,
  recordsServerData,
  recordServerData,
}) => {
  const table = useTable();
  const router = useRouter();
  const { nodeId, viewId } = router.query;
  useTitle(table?.name ? `${table?.icon ? table.icon + ' ' : ''}${table.name}` : 'Teable');

  return (
    <AnchorContext.Provider value={{ tableId: nodeId as string, viewId: viewId as string }}>
      <ViewProvider serverData={viewServerData}>
        <AggregationProvider>
          <div className="grow flex flex-col h-full basis-[500px]">
            <TableHeader />
            <FieldProvider serverSideData={fieldServerData}>
              <ToolBar />
              <RecordProvider serverData={recordsServerData}>
                <RowCountProvider>
                  <ErrorBoundary
                    fallback={
                      <div className="w-full h-full flex justify-center items-center">
                        <FailAlert />
                      </div>
                    }
                  >
                    <View recordServerData={recordServerData} />
                  </ErrorBoundary>
                </RowCountProvider>
              </RecordProvider>
            </FieldProvider>
          </div>
        </AggregationProvider>
      </ViewProvider>
    </AnchorContext.Provider>
  );
};
