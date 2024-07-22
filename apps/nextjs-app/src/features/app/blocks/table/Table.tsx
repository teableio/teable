import type { IFieldVo, IRecord, IViewVo } from '@teable/core';
import type { IGetBaseVo } from '@teable/openapi';
import { AnchorContext, FieldProvider, useTable, ViewProvider } from '@teable/sdk';
import { TablePermissionProvider } from '@teable/sdk/context/table-permission';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { ErrorBoundary } from 'react-error-boundary';
import { FailAlert } from '../table-list/FailAlert';
import { View } from '../view/View';
import { TableHeader } from './table-header/TableHeader';
import { ViewCheck } from './ViewCheck';

export interface ITableProps {
  baseServerData: IGetBaseVo;
  fieldServerData: IFieldVo[];
  viewServerData: IViewVo[];
  recordsServerData: { records: IRecord[] };
  recordServerData?: IRecord;
}

export const Table: React.FC<ITableProps> = ({
  baseServerData,
  fieldServerData,
  viewServerData,
  recordsServerData,
  recordServerData,
}) => {
  const table = useTable();
  const router = useRouter();
  const { baseId, tableId, viewId } = router.query as {
    tableId: string;
    viewId: string;
    baseId: string;
  };
  return (
    <AnchorContext.Provider value={{ tableId, viewId, baseId }}>
      <Head>
        <title>
          {table?.name
            ? `${table?.icon ? table.icon + ' ' : ''}${table.name}: ${baseServerData.name} - Teable`
            : 'Teable'}
        </title>
      </Head>
      <TablePermissionProvider baseId={baseId}>
        <ViewProvider serverData={viewServerData}>
          <div className="flex h-full grow basis-[500px] flex-col">
            <TableHeader />
            <ViewCheck>
              <FieldProvider serverSideData={fieldServerData}>
                <ErrorBoundary
                  fallback={
                    <div className="flex size-full items-center justify-center">
                      <FailAlert />
                    </div>
                  }
                >
                  <View recordServerData={recordServerData} recordsServerData={recordsServerData} />
                </ErrorBoundary>
              </FieldProvider>
            </ViewCheck>
          </div>
        </ViewProvider>
      </TablePermissionProvider>
    </AnchorContext.Provider>
  );
};
