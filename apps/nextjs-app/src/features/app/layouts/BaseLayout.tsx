import type { DehydratedState } from '@tanstack/react-query';
import type { IGetBaseVo, ITableVo } from '@teable/openapi';
import type { IUser } from '@teable/sdk';
import { ExpandRecordNavigationContext, NotificationProvider, SessionProvider } from '@teable/sdk';
import { AnchorContext, AppProvider, BaseProvider, TableProvider } from '@teable/sdk/context';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import React, { Fragment, useCallback, useMemo } from 'react';
import { AppLayout } from '@/features/app/layouts';
import { WorkFlowPanelModal } from '../automation/workflow-panel/WorkFlowPanelModal';
import { BaseNodeProvider } from '../blocks/base/base-node/BaseNodeProvider';
import { BaseSideBar } from '../blocks/base/base-side-bar/BaseSideBar';
import { BaseSidebarHeaderLeft } from '../blocks/base/base-side-bar/BaseSidebarHeaderLeft';
import { QuickAction } from '../blocks/base/base-side-bar/QuickAction';
import { BasePermissionListener } from '../blocks/base/BasePermissionListener';
import { useTableHref } from '../blocks/table-list/useTableHref';
import { useGridSearchStore } from '../blocks/view/grid/useGridSearchStore';
import { UsageLimitModal } from '../components/billing/UsageLimitModal';
import { LinkConnectorLine } from '../components/LinkConnectorLine';
import { Sidebar } from '../components/sidebar/Sidebar';
import { SideBarFooter } from '../components/SideBarFooter';
import { UploadProgressPanel } from '../components/upload-progress-panel/UploadProgressPanel';
import type { IBaseResourceTable } from '../hooks/useBaseResource';
import { useBaseResource } from '../hooks/useBaseResource';
import { useEnv } from '../hooks/useEnv';
import { useSdkLocale } from '../hooks/useSdkLocale';
import { TemplateBaseLayout } from './TemplateBaseLayout';

const BaseLayoutInner: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const router = useRouter();
  const { setHighlightedTableId } = useGridSearchStore();
  const { hrefMap: tableHrefMap, viewIdMap: tableViewIdsMap } = useTableHref();

  const navigateToTable = useCallback(
    (tableId: string) => {
      const url = tableHrefMap[tableId];
      const viewId = tableViewIdsMap[tableId];
      if (url) {
        router.push({ pathname: url }, undefined, { shallow: Boolean(viewId) });
      }
    },
    [tableHrefMap, tableViewIdsMap, router]
  );

  const expandRecordNavValue = useMemo(
    () => ({ onHighlightTable: setHighlightedTableId, navigateToTable }),
    [setHighlightedTableId, navigateToTable]
  );

  return (
    <ExpandRecordNavigationContext.Provider value={expandRecordNavValue}>
      <div
        id="portal"
        className="relative flex h-screen w-full items-start"
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="flex h-screen w-full">
          <Sidebar headerLeft={<BaseSidebarHeaderLeft />} headerRight={<QuickAction />}>
            <Fragment>
              <div className="flex h-full flex-col gap-2 divide-y divide-solid overflow-auto py-2">
                <BaseSideBar />
              </div>
              <div className="grow basis-0" />
              <SideBarFooter />
            </Fragment>
          </Sidebar>
          <div className="min-w-80 flex-1">{children}</div>
        </div>
        <UploadProgressPanel />
      </div>
      <LinkConnectorLine />
      <UsageLimitModal />
      <WorkFlowPanelModal />
    </ExpandRecordNavigationContext.Provider>
  );
};

export const BaseLayout: React.FC<{
  children: React.ReactNode;
  tableServerData?: ITableVo[];
  dehydratedState?: DehydratedState;
  user?: IUser;
  base?: IGetBaseVo;
}> = ({ children, ...props }) => {
  const { tableServerData, user, dehydratedState } = props;
  const { baseId, tableId, viewId } = useBaseResource() as IBaseResourceTable;
  const sdkLocale = useSdkLocale();
  const { i18n } = useTranslation();
  const { maxSearchFieldCount } = useEnv();
  return (
    <TemplateBaseLayout {...props} childrenContent={children}>
      <AppLayout>
        <AppProvider
          lang={i18n.language}
          locale={sdkLocale}
          dehydratedState={dehydratedState}
          maxSearchFieldCount={maxSearchFieldCount}
        >
          <SessionProvider user={user}>
            <NotificationProvider>
              <AnchorContext.Provider
                value={{
                  baseId: baseId as string,
                  tableId: tableId as string,
                  viewId: viewId as string,
                }}
              >
                <BaseProvider>
                  <BaseNodeProvider>
                    <BasePermissionListener />
                    <TableProvider serverData={tableServerData}>
                      <BaseLayoutInner>{children}</BaseLayoutInner>
                    </TableProvider>
                  </BaseNodeProvider>
                </BaseProvider>
              </AnchorContext.Provider>
            </NotificationProvider>
          </SessionProvider>
        </AppProvider>
      </AppLayout>
    </TemplateBaseLayout>
  );
};
