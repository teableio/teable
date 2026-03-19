import type { DehydratedState } from '@tanstack/react-query';
import type { IGetBaseVo, ITableVo } from '@teable/openapi';
import { SessionProvider, addQueryParamsToWebSocketUrl } from '@teable/sdk';
import type { IUser } from '@teable/sdk/context';
import { AnchorContext, AppProvider, BaseProvider, TableProvider } from '@teable/sdk/context';
import { getWsPath } from '@teable/sdk/context/app/useConnection';
import { useTranslation } from 'next-i18next';
import React, { Fragment, useMemo } from 'react';
import { AppLayout } from '@/features/app/layouts';
import { BaseNodeProvider } from '../blocks/base/base-node/BaseNodeProvider';
import { BaseSideBar } from '../blocks/base/base-side-bar/BaseSideBar';
import { BaseSidebarHeaderLeft } from '../blocks/base/base-side-bar/BaseSidebarHeaderLeft';
import { BasePermissionListener } from '../blocks/base/BasePermissionListener';
import { Sidebar } from '../components/sidebar/Sidebar';
import { SideBarFooter } from '../components/SideBarFooter';
import { ShareContext } from '../context/ShareContext';
import type { IBaseResourceTable } from '../hooks/useBaseResource';
import { useBaseResource } from '../hooks/useBaseResource';
import { useEnv } from '../hooks/useEnv';
import { useSdkLocale } from '../hooks/useSdkLocale';
import { initAxios } from '../utils/init-axios';

interface IShareBaseLayoutProps {
  children: React.ReactNode;
  tableServerData?: ITableVo[];
  dehydratedState?: DehydratedState;
  user?: IUser;
  base?: IGetBaseVo;
  shareId?: string;
  shareNodeId?: string;
  allowSave?: boolean;
  allowCopy?: boolean;
}

export const ShareBaseLayout: React.FC<IShareBaseLayoutProps> = ({
  children,
  tableServerData,
  dehydratedState,
  user,
  shareId,
  shareNodeId,
  allowSave,
  allowCopy,
}) => {
  const { baseId, tableId, viewId } = useBaseResource() as IBaseResourceTable;
  const sdkLocale = useSdkLocale();
  const { i18n } = useTranslation();
  const { maxSearchFieldCount } = useEnv();

  const isShare = !!shareId;

  // Initialize axios with share header (synchronous, like template)
  if (isShare) {
    initAxios({ shareId });
  }

  const wsPath = useMemo(() => {
    if (typeof window === 'object' && shareId) {
      return addQueryParamsToWebSocketUrl(getWsPath(), { baseShareId: shareId });
    }
    return undefined;
  }, [shareId]);

  // Share context value with URL prefix and nodeId for filtering
  const shareContextValue = useMemo(
    () => ({
      shareId,
      urlPrefix: shareId ? `/share/${shareId}` : undefined,
      nodeId: shareNodeId,
      allowSave,
      allowCopy,
    }),
    [shareId, shareNodeId, allowSave, allowCopy]
  );

  // If not a share context, just render children (fallback)
  if (!isShare) {
    return <>{children}</>;
  }

  return (
    <ShareContext.Provider value={shareContextValue}>
      <AppLayout>
        <AppProvider
          lang={i18n.language}
          locale={sdkLocale}
          dehydratedState={dehydratedState}
          wsPath={wsPath}
          shareId={shareId}
          maxSearchFieldCount={maxSearchFieldCount}
        >
          <SessionProvider user={user} disabledApi>
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
                    <div
                      id="portal"
                      className="relative flex h-screen w-full items-start"
                      onContextMenu={(e) => e.preventDefault()}
                    >
                      <div className="flex h-screen w-full">
                        <Sidebar headerLeft={<BaseSidebarHeaderLeft />}>
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
                    </div>
                  </TableProvider>
                </BaseNodeProvider>
              </BaseProvider>
            </AnchorContext.Provider>
          </SessionProvider>
        </AppProvider>
      </AppLayout>
    </ShareContext.Provider>
  );
};
