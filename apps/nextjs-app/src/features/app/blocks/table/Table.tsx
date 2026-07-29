import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { IFieldVo, IRecord, IViewVo } from '@teable/core';
import {
  getBaseById,
  getRowCount,
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
  useIsReadOnlyPreview,
} from '@teable/sdk';
import { TablePermissionProvider } from '@teable/sdk/context/table-permission';
import { usePersonalViewStore } from '@teable/sdk/context/view/store';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useRef } from 'react';
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
import { useTableSeed } from './hooks/use-table-seed';
import { useViewErrorHandler } from './hooks/use-view-error-handler';
import { TableHeader } from './table-header/TableHeader';

export interface ITableProps {
  fieldServerData: IFieldVo[];
  viewServerData: IViewVo[];
  recordsServerData: { records: IRecord[] };
  recordServerData?: IRecord;
  groupPointsServerDataMap?: { [viewId: string]: IGroupPointsVo | null };
}

const EMPTY_RECORDS_DATA: { records: IRecord[] } = { records: [] };

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
  const router = useRouter();
  const isReadOnlyPreview = useIsReadOnlyPreview();
  const { baseId, tableId, viewId } = useBaseResource() as IBaseResourceTable;

  // A shallow navigation can land on /base/x/table/y without a view segment,
  // and nothing can load without a view. Re-run the navigation non-shallowly
  // so getServerSideProps resolves the last-visited/default view and redirects.
  useEffect(() => {
    if (viewId || !tableId || isReadOnlyPreview) return;
    router.replace(router.asPath, undefined, { shallow: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId, viewId, isReadOnlyPreview]);

  const table = tables.find((t) => t.id === tableId);

  const { data: base } = useQuery({
    queryKey: ReactQueryKeys.base(baseId as string),
    queryFn: ({ queryKey }) => getBaseById(queryKey[1]).then((res) => res.data),
  });

  const { brandName } = useBrand();

  // SSR props describe exactly the (table, view) that getServerSideProps
  // rendered; navigation is shallow-routed, so once the user goes anywhere
  // else — another table or even another view of the same table — the
  // page-load-era snapshot is no longer trustworthy. From then on the
  // bounded seed query takes over as the bootstrap source.
  const initialAnchorRef = useRef({ tableId, viewId });
  const ssrDataFresh =
    initialAnchorRef.current.tableId === tableId && initialAnchorRef.current.viewId === viewId;

  const { data: tableSeed } = useTableSeed(
    tableId,
    viewId,
    Boolean(tableId && viewId) && !ssrDataFresh && !isReadOnlyPreview
  );

  const isPersonalViewActive = usePersonalViewStore((state) =>
    Boolean(viewId && state.personalViewMap[viewId])
  );

  // fire the row count request concurrently with the seed fetch instead of
  // waiting for RowCountProvider to mount (which needs the view to be ready).
  // The provider's initial query key hashes identically ({ viewId } plus
  // undefined-valued keys, which react-query drops), so this lands in-cache.
  // A personal view changes the provider's key, so prefetching would only
  // issue a second, unused count query — skip it there.
  useEffect(() => {
    if (isReadOnlyPreview || !tableId || !viewId || isPersonalViewActive) return;
    queryClient.prefetchQuery({
      queryKey: ReactQueryKeys.rowCount(tableId, { viewId }),
      queryFn: () => getRowCount(tableId, { viewId }).then((res) => res.data),
    });
  }, [queryClient, tableId, viewId, isReadOnlyPreview, isPersonalViewActive]);

  const {
    effectiveFieldData,
    effectiveViewData,
    effectiveRecordsData,
    effectiveRecordData,
    effectiveGroupPointsMap,
  } = useMemo(() => {
    if (ssrDataFresh) {
      return {
        effectiveFieldData: fieldServerData,
        effectiveViewData: viewServerData,
        effectiveRecordsData: recordsServerData,
        effectiveRecordData: recordServerData,
        effectiveGroupPointsMap: groupPointsServerDataMap,
      };
    }
    const seedRecords = tableSeed?.records?.records;
    return {
      effectiveFieldData: tableSeed?.fields,
      effectiveViewData: tableSeed?.views,
      effectiveRecordsData: seedRecords ? { records: seedRecords } : undefined,
      effectiveRecordData: undefined,
      effectiveGroupPointsMap:
        tableSeed && viewId ? { [viewId]: tableSeed.groupPoints } : undefined,
    };
  }, [
    ssrDataFresh,
    fieldServerData,
    viewServerData,
    recordsServerData,
    recordServerData,
    groupPointsServerDataMap,
    tableSeed,
    viewId,
  ]);

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
        <ViewProvider serverData={effectiveViewData}>
          <PersonalViewProxy serverData={effectiveViewData}>
            <FieldProvider serverSideData={effectiveFieldData}>
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
                        recordServerData={effectiveRecordData}
                        recordsServerData={effectiveRecordsData ?? EMPTY_RECORDS_DATA}
                        groupPointsServerDataMap={effectiveGroupPointsMap}
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
