import { type DehydratedState } from '@tanstack/react-query';
import { incrementTemplateVisit, type IGetBaseVo, type ITableVo } from '@teable/openapi';
import { SessionProvider, addQueryParamsToWebSocketUrl } from '@teable/sdk';
import type { IUser } from '@teable/sdk/context';
import { AnchorContext, AppProvider, BaseProvider, TableProvider } from '@teable/sdk/context';
import { getWsPath } from '@teable/sdk/context/app/useConnection';
import { useTranslation } from 'next-i18next';
import React, { Fragment, useEffect, useMemo } from 'react';
import { AppLayout } from '@/features/app/layouts';
import { BaseNodeProvider } from '../blocks/base/base-node/BaseNodeProvider';
import { BaseSideBar } from '../blocks/base/base-side-bar/BaseSideBar';
import { BaseSidebarHeaderLeft } from '../blocks/base/base-side-bar/BaseSidebarHeaderLeft';
import { BasePermissionListener } from '../blocks/base/BasePermissionListener';
import { Sidebar } from '../components/sidebar/Sidebar';
import { SideBarFooter } from '../components/SideBarFooter';
import type { IBaseResourceTable } from '../hooks/useBaseResource';
import { useBaseResource } from '../hooks/useBaseResource';
import { useSdkLocale } from '../hooks/useSdkLocale';
import { initAxios } from '../utils/init-axios';

export const TemplateBaseLayout = ({
  children,
  base,
  dehydratedState,
  user,
  tableServerData,
  childrenContent,
}: {
  children: React.ReactNode;
  tableServerData?: ITableVo[];
  dehydratedState?: DehydratedState;
  user?: IUser;
  base?: IGetBaseVo;
  childrenContent: React.ReactNode;
}) => {
  const { baseId, tableId, viewId } = useBaseResource() as IBaseResourceTable;
  const sdkLocale = useSdkLocale();
  const { i18n } = useTranslation();
  const isTemplate = !!base?.template;
  const templateHeader = base?.template?.headers;
  initAxios(base);

  const wsPath = useMemo(() => {
    if (typeof window === 'object' && templateHeader) {
      return addQueryParamsToWebSocketUrl(getWsPath(), { templateHeader });
    }
    return undefined;
  }, [templateHeader]);

  useEffect(() => {
    if (isTemplate && base?.template?.id) {
      incrementTemplateVisit(base?.template?.id);
    }
  }, [isTemplate, base?.template?.id]);

  if (!isTemplate) {
    return children;
  }

  return (
    <AppLayout>
      <AppProvider
        lang={i18n.language}
        locale={sdkLocale}
        dehydratedState={dehydratedState}
        template={base?.template}
        wsPath={wsPath}
      >
        <SessionProvider user={user}>
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
                      <div className="min-w-80 flex-1">{childrenContent}</div>
                    </div>
                  </div>
                </TableProvider>
              </BaseNodeProvider>
            </BaseProvider>
          </AnchorContext.Provider>
        </SessionProvider>
      </AppProvider>
    </AppLayout>
  );
};
