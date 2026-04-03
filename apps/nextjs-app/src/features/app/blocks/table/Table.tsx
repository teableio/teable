import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { IFieldVo, IRecord, IViewVo } from '@teable/core';
import { ViewType } from '@teable/core';
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
  ShareSessionViewStoreProvider,
  ReactQueryKeys,
  useTables,
  useIsReadOnlyPreview,
} from '@teable/sdk';
import { TablePermissionProvider } from '@teable/sdk/context/table-permission';
import Head from 'next/head';
import { useEffect, useMemo } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { useHotkeys } from 'react-hotkeys-hook';
import {
  CellDownloadHandler,
  DownloadAllAttachmentsDialog,
} from '../../components/download-attachments';
import { PluginContextMenu } from '../../components/plugin-context-menu/PluginContextMenu';
import { PluginPanel } from '../../components/plugin-panel/PluginPanel';
import { useShareContext, useShareEffectiveEdit } from '../../context/ShareContext';
import type { IBaseResourceTable } from '../../hooks/useBaseResource';
import { useBaseResource } from '../../hooks/useBaseResource';
import { useBrand } from '../../hooks/useBrand';
import { View } from '../view/View';
import { FailAlert } from './FailAlert';
import { useViewErrorHandler } from './hooks/use-view-error-handler';
import { TableHeader } from './table-header/TableHeader';

const SessionViewStoreWrapper = ({
  useSession,
  initialViewMap,
  children,
}: {
  useSession: boolean;
  initialViewMap?: Record<string, Record<string, unknown>>;
  children: React.ReactNode;
}) => {
  if (useSession && initialViewMap) {
    return (
      <ShareSessionViewStoreProvider initialViewMap={initialViewMap}>
        {children}
      </ShareSessionViewStoreProvider>
    );
  }
  return <>{children}</>;
};

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
  const isReadOnlyPreview = useIsReadOnlyPreview();
  const { baseId, tableId, viewId } = useBaseResource() as IBaseResourceTable;
  const { shareId } = useShareContext();
  const isShareEditor = useShareEffectiveEdit();

  // In share mode without effective edit (can view / anonymous), or template mode, use session-only personal view
  const isTemplate = isReadOnlyPreview && !shareId;
  const useSessionPersonalView = isTemplate || Boolean(shareId && !isShareEditor);

  // Build initial view map from server data for session-only personal view
  const initialViewMap = useMemo(() => {
    if (!useSessionPersonalView) return undefined;
    const map: Record<string, Record<string, unknown>> = {};
    for (const view of viewServerData) {
      if (view.type === ViewType.Plugin || view.type === ViewType.Form) continue;
      map[view.id] = {
        id: view.id,
        type: view.type,
        filter: view.filter,
        sort: view.sort,
        group: view.group,
        options: view.options,
        columnMeta: view.columnMeta,
      };
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useSessionPersonalView]);

  const table = tables.find((t) => t.id === tableId);

  const { data: base } = useQuery({
    queryKey: ReactQueryKeys.base(baseId as string),
    queryFn: ({ queryKey }) => getBaseById(queryKey[1]).then((res) => res.data),
  });

  const { brandName } = useBrand();

  useEffect(() => {
    // Skip last visit tracking in template or share mode
    if (isReadOnlyPreview) return;
    updateUserLastVisit({
      resourceId: tableId,
      childResourceId: viewId,
      parentResourceId: baseId,
      resourceType: LastVisitResourceType.Table,
    }).then(() => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.userLastVisitMap(baseId) });
    });
  }, [tableId, viewId, baseId, queryClient, isReadOnlyPreview]);

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
          <SessionViewStoreWrapper
            useSession={useSessionPersonalView}
            initialViewMap={initialViewMap}
          >
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
          </SessionViewStoreWrapper>
        </ViewProvider>
      </TablePermissionProvider>
    </AnchorContext.Provider>
  );
};
