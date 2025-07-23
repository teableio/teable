import type { DehydratedState } from '@tanstack/react-query';
import type { ITableVo } from '@teable/openapi';
import { NotificationProvider, SessionProvider } from '@teable/sdk';
import type { IUser } from '@teable/sdk';
import { AnchorContext, AppProvider, BaseProvider, TableProvider } from '@teable/sdk/context';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import React, { Fragment } from 'react';
import { AppLayout } from '@/features/app/layouts';
import { WorkFlowPanelModal } from '../automation/workflow-panel/WorkFlowPanelModal';
import { BaseSideBar } from '../blocks/base/base-side-bar/BaseSideBar';
import { BaseSidebarHeaderLeft } from '../blocks/base/base-side-bar/BaseSidebarHeaderLeft';
import { BasePermissionListener } from '../blocks/base/BasePermissionListener';
import { UsageLimitModal } from '../components/billing/UsageLimitModal';
import { Sidebar } from '../components/sidebar/Sidebar';
import { SideBarFooter } from '../components/SideBarFooter';
import { useSdkLocale } from '../hooks/useSdkLocale';

export const BaseLayout: React.FC<{
  children: React.ReactNode;
  tableServerData: ITableVo[];
  dehydratedState?: DehydratedState;
  user?: IUser;
}> = ({ children, tableServerData, user, dehydratedState }) => {
  const router = useRouter();
  const { baseId, tableId, viewId } = router.query;
  const sdkLocale = useSdkLocale();
  const { i18n } = useTranslation();

  return (
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
                          <div className="flex flex-col gap-2 divide-y divide-solid overflow-auto py-2">
                            <BaseSideBar />
                          </div>
                          <div className="grow basis-0" />
                          <SideBarFooter />
                        </Fragment>
                      </Sidebar>
                      <div className="min-w-80 flex-1">{children}</div>
                    </div>
                  </div>
                  <UsageLimitModal />
                  <WorkFlowPanelModal />
                </TableProvider>
              </BaseProvider>
            </AnchorContext.Provider>
          </NotificationProvider>
        </SessionProvider>
      </AppProvider>
    </AppLayout>
  );
};
