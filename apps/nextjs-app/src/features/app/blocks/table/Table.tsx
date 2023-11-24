import type { IFieldVo, IRecord, IViewVo } from '@teable-group/core';
import { AnchorContext, FieldProvider, useTable, ViewProvider } from '@teable-group/sdk';
import { useRouter } from 'next/router';
import { ErrorBoundary } from 'react-error-boundary';
import { useTitle } from 'react-use';
import { FailAlert } from '../table-list/FailAlert';
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
  const { nodeId, viewId } = router.query as { nodeId: string; viewId: string };
  useTitle(table?.name ? `${table?.icon ? table.icon + ' ' : ''}${table.name}` : 'Teable');

  return (
    <AnchorContext.Provider value={{ tableId: nodeId, viewId: viewId }}>
      <ViewProvider serverData={viewServerData}>
        <div className="flex h-full grow basis-[500px] flex-col">
          <TableHeader />
          <FieldProvider serverSideData={fieldServerData}>
            <ErrorBoundary
              fallback={
                <div className="flex h-full w-full items-center justify-center">
                  <FailAlert />
                </div>
              }
            >
              <View recordServerData={recordServerData} recordsServerData={recordsServerData} />
            </ErrorBoundary>
          </FieldProvider>
        </div>
      </ViewProvider>
    </AnchorContext.Provider>
  );
};
