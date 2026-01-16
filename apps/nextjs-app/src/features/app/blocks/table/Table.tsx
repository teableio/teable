import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { IFieldVo, IRecord, IViewVo } from '@teable/core';
import {
  getBaseById,
  LastVisitResourceType,
  updateUserLastVisit,
  type IGroupPointsVo,
} from '@teable/openapi';
import {
  AnchorContext,
  FieldProvider,
  useUndoRedo,
  ViewProvider,
  PersonalViewProxy,
  PersonalViewProvider,
  ReactQueryKeys,
  useTables,
  useIsTemplate,
} from '@teable/sdk';
import { TablePermissionProvider } from '@teable/sdk/context/table-permission';
import Head from 'next/head';
import { useEffect } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { useHotkeys } from 'react-hotkeys-hook';
import {
  CellDownloadHandler,
  DownloadAllAttachmentsDialog,
} from '../../components/download-attachments';
import { PluginContextMenu } from '../../components/plugin-context-menu/PluginContextMenu';
import { PluginPanel } from '../../components/plugin-panel/PluginPanel';
import type { IBaseResourceTable } from '../../hooks/useBaseResource';
import { useBaseResource } from '../../hooks/useBaseResource';
import { useBrand } from '../../hooks/useBrand';
import { View } from '../view/View';
import { FailAlert } from './FailAlert';
import { useViewErrorHandler } from './hooks/use-view-error-handler';
import { TableHeader } from './table-header/TableHeader';

export interface ITableProps {
  fieldServerData: IFieldVo[];
  viewServerData: IViewVo[];
  recordsServerData: { records: IRecord[] };
  recordServerData?: IRecord;
  groupPointsServerDataMap?: { [viewId: string]: IGroupPointsVo | null };
}

export const Table: React.FC<ITableProps> = ({
  fieldServerData,
  viewServerData,
  recordsServerData,
  recordServerData,
  groupPointsServerDataMap,
}) => {
  const tables = useTables();
  const { undo, redo } = useUndoRedo();
  const queryClient = useQueryClient();
  const isTemplate = useIsTemplate();
  const { baseId, tableId, viewId } = useBaseResource() as IBaseResourceTable;

  const table = tables.find((t) => t.id === tableId);

  const { data: base } = useQuery({
    queryKey: ReactQueryKeys.base(baseId as string),
    queryFn: ({ queryKey }) => getBaseById(queryKey[1]).then((res) => res.data),
  });

  const { brandName } = useBrand();

  useEffect(() => {
    if (isTemplate) return;
    updateUserLastVisit({
      resourceId: tableId,
      childResourceId: viewId,
      parentResourceId: baseId,
      resourceType: LastVisitResourceType.Table,
    }).then(() => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.userLastVisitMap(baseId) });
    });
  }, [tableId, viewId, baseId, queryClient, isTemplate]);

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
            ? `${table?.icon ? table.icon + ' ' : ''}${table.name}: ${base?.name} - ${brandName}`
            : `${brandName}`}
        </title>
        <style data-fullcalendar></style>
      </Head>
      <TablePermissionProvider baseId={baseId}>
        <ViewProvider serverData={viewServerData}>
          <PersonalViewProxy serverData={viewServerData}>
            <FieldProvider serverSideData={fieldServerData}>
              <PersonalViewProvider>
                <div className="flex h-full grow basis-[500px]">
                  <div
                    className="flex flex-1 flex-col overflow-hidden"
                    data-screenshot-target="base-view"
                  >
                    <TableHeader />
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
                  </div>
                  <PluginPanel tableId={tableId} />
                  <PluginContextMenu tableId={tableId} baseId={baseId} />
                  <DownloadAllAttachmentsDialog />
                  <CellDownloadHandler />
                  {/* <ChatPanel /> */}
                </div>
              </PersonalViewProvider>
            </FieldProvider>
          </PersonalViewProxy>
        </ViewProvider>
      </TablePermissionProvider>
    </AnchorContext.Provider>
  );
};
