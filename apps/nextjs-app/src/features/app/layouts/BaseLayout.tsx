import type { DehydratedState } from '@tanstack/react-query';
import type { IGetBaseVo, ITableVo } from '@teable/openapi';
import type { IUser } from '@teable/sdk';
import { NotificationProvider, SessionProvider } from '@teable/sdk';
import { AnchorContext, AppProvider, BaseProvider, TableProvider } from '@teable/sdk/context';
import { useTranslation } from 'next-i18next';
import React, { Fragment } from 'react';
import { AppLayout } from '@/features/app/layouts';
import { WorkFlowPanelModal } from '../automation/workflow-panel/WorkFlowPanelModal';
import { BaseNodeProvider } from '../blocks/base/base-node/BaseNodeProvider';
import { BaseSideBar } from '../blocks/base/base-side-bar/BaseSideBar';
import { BaseSidebarHeaderLeft } from '../blocks/base/base-side-bar/BaseSidebarHeaderLeft';
import { QuickAction } from '../blocks/base/base-side-bar/QuickAction';
import { BasePermissionListener } from '../blocks/base/BasePermissionListener';
import { UsageLimitModal } from '../components/billing/UsageLimitModal';
import { Sidebar } from '../components/sidebar/Sidebar';
import { SideBarFooter } from '../components/SideBarFooter';
import { UploadProgressPanel } from '../components/upload-progress-panel/UploadProgressPanel';
import type { IBaseResourceTable } from '../hooks/useBaseResource';
import { useBaseResource } from '../hooks/useBaseResource';
import { useSdkLocale } from '../hooks/useSdkLocale';
import { TemplateBaseLayout } from './TemplateBaseLayout';

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

  return (
    <TemplateBaseLayout {...props} childrenContent={children}>
      <AppLayout>
        <AppProvider lang={i18n.language} locale={sdkLocale} dehydratedState={dehydratedState}>
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
                      <div
                        id="portal"
                        className="relative flex h-screen w-full items-start"
                        onContextMenu={(e) => e.preventDefault()}
                      >
                        <div className="flex h-screen w-full">
                          <Sidebar
                            headerLeft={<BaseSidebarHeaderLeft />}
                            headerRight={<QuickAction />}
                          >
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
                      <UsageLimitModal />
                      <WorkFlowPanelModal />
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
