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
import { useAggregationsQuery } from './hooks/use-aggregations-query';
import { useRowCountQuery } from './hooks/use-row-count-query';
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
  const { nodeId, viewId } = router.query as { nodeId: string; viewId: string };
  useTitle(table?.name ? `${table?.icon ? table.icon + ' ' : ''}${table.name}` : 'Teable');

  const aggregationView = useAggregationsQuery(nodeId, viewId);
  const rowCountView = useRowCountQuery(nodeId, viewId);

  return (
    <AnchorContext.Provider value={{ tableId: nodeId, viewId: viewId }}>
      <ViewProvider serverData={viewServerData}>
        <AggregationProvider aggregationWithoutConnected={aggregationView}>
          <div className="flex h-full grow basis-[500px] flex-col">
            <TableHeader />
            <FieldProvider serverSideData={fieldServerData}>
              <ToolBar />
              <RecordProvider serverData={recordsServerData}>
                <RowCountProvider rowCountWithoutConnected={rowCountView}>
                  <ErrorBoundary
                    fallback={
                      <div className="flex h-full w-full items-center justify-center">
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
