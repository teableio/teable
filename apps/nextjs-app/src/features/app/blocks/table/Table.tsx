import type { IFieldVo, IRecord, IViewVo } from '@teable/core';
import type { IGetBaseVo, IGroupPointsVo } from '@teable/openapi';
import { AnchorContext, FieldProvider, useTable, useUndoRedo, ViewProvider } from '@teable/sdk';
import { TablePermissionProvider } from '@teable/sdk/context/table-permission';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { ErrorBoundary } from 'react-error-boundary';
import { useHotkeys } from 'react-hotkeys-hook';
import { View } from '../view/View';
import { FailAlert } from './FailAlert';
import { useViewErrorHandler } from './hooks/use-view-error-handler';
import { TableHeader } from './table-header/TableHeader';

export interface ITableProps {
  baseServerData: IGetBaseVo;
  fieldServerData: IFieldVo[];
  viewServerData: IViewVo[];
  recordsServerData: { records: IRecord[] };
  recordServerData?: IRecord;
  groupPointsServerDataMap?: { [viewId: string]: IGroupPointsVo | undefined };
}

export const Table: React.FC<ITableProps> = ({
  baseServerData,
  fieldServerData,
  viewServerData,
  recordsServerData,
  recordServerData,
  groupPointsServerDataMap,
}) => {
  const table = useTable();
  const router = useRouter();
  const { undo, redo } = useUndoRedo();
  const { baseId, tableId, viewId } = router.query as {
    tableId: string;
    viewId: string;
    baseId: string;
  };
  useViewErrorHandler(baseId, tableId, viewId);
  useHotkeys(`mod+z`, () => undo(), {
    preventDefault: true,
  });

  useHotkeys([`mod+shift+z`, `mod+y`], () => redo(), {
    preventDefault: true,
  });

  return (
    <AnchorContext.Provider value={{ tableId, viewId, baseId }}>
      <Head>
        <title>
          {table?.name
            ? `${table?.icon ? table.icon + ' ' : ''}${table.name}: ${baseServerData.name} - Teable`
            : 'Teable'}
        </title>
        <style data-fullcalendar></style>
      </Head>
      <TablePermissionProvider baseId={baseId}>
        <ViewProvider serverData={viewServerData}>
          <div className="flex h-full grow basis-[500px] flex-col">
            <TableHeader />
            <FieldProvider serverSideData={fieldServerData}>
              <ErrorBoundary
                fallback={
                  <div className="flex size-full items-center justify-center">
                    <FailAlert />
                  </div>
                }
              >
                <View
                  recordServerData={recordServerData}
                  recordsServerData={recordsServerData}
                  groupPointsServerDataMap={groupPointsServerDataMap}
                />
              </ErrorBoundary>
            </FieldProvider>
          </div>
        </ViewProvider>
      </TablePermissionProvider>
    </AnchorContext.Provider>
  );
};
