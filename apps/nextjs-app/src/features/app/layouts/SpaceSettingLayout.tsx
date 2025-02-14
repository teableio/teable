import type { DehydratedState } from '@tanstack/react-query';
import { Component, Home, Integration, Users } from '@teable/icons';
import type { IGetSpaceVo } from '@teable/openapi';
import type { IUser } from '@teable/sdk';
import { NotificationProvider, ReactQueryKeys, SessionProvider } from '@teable/sdk';
import { AppProvider } from '@teable/sdk/context';
import { find } from 'lodash';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import React, { Fragment, useMemo } from 'react';
import { spaceConfig } from '@/features/i18n/space.config';
import { Sidebar } from '../components/sidebar/Sidebar';
import { SidebarContent } from '../components/sidebar/SidebarContent';
import { SidebarHeaderLeft } from '../components/sidebar/SidebarHeaderLeft';
import { SideBarFooter } from '../components/SideBarFooter';
import { useSdkLocale } from '../hooks/useSdkLocale';
import { AppLayout } from './AppLayout';

export const SpaceSettingLayout: React.FC<{
  children: React.ReactNode;
  user?: IUser;
  dehydratedState?: DehydratedState;
}> = ({ children, user, dehydratedState }) => {
  const sdkLocale = useSdkLocale();
  const { i18n } = useTranslation();
  const { t } = useTranslation(spaceConfig.i18nNamespaces);
  const router = useRouter();
  const spaceId = router.query.spaceId as string;
  const space = find(dehydratedState?.queries || [], {
    queryHash: JSON.stringify(ReactQueryKeys.space(spaceId)),
  })?.state.data as IGetSpaceVo;

  const onBack = () => {
    if (!spaceId) return router.push({ pathname: '/space' });

    router.push({
      pathname: '/space/[spaceId]',
      query: { spaceId },
    });
  };

  const routes = useMemo(() => {
    return [
      {
        Icon: Home,
        label: t('space:spaceSetting.general'),
        route: `/space/[spaceId]/setting/general`,
        pathTo: `/space/${spaceId}/setting/general`,
      },
      {
        Icon: Users,
        label: t('space:spaceSetting.collaborators'),
        route: `/space/[spaceId]/setting/collaborator`,
        pathTo: `/space/${spaceId}/setting/collaborator`,
      },
      {
        Icon: Integration,
        label: t('space:integration.title'),
        route: `/space/[spaceId]/setting/integration`,
        pathTo: `/space/${spaceId}/setting/integration`,
      },
    ];
  }, [spaceId, t]);

  return (
    <AppLayout>
      <Head>
        <title>{spaceId && dehydratedState ? space.name : t('allSpaces')}</title>
      </Head>
      <AppProvider locale={sdkLocale} lang={i18n.language} dehydratedState={dehydratedState}>
        <SessionProvider user={user}>
          <NotificationProvider>
            <div id="portal" className="relative flex h-screen w-full items-start">
              <Sidebar
                headerLeft={
                  <SidebarHeaderLeft
                    title={space.name}
                    icon={<Component className="size-5 shrink-0" />}
                    onBack={onBack}
                  />
                }
              >
                <Fragment>
                  <div className="flex flex-1 flex-col gap-2 divide-y divide-solid overflow-hidden">
                    <SidebarContent title={t('space:spaceSetting.title')} routes={routes} />
                  </div>
                  <SideBarFooter />
                </Fragment>
              </Sidebar>
              {children}
            </div>
          </NotificationProvider>
        </SessionProvider>
      </AppProvider>
    </AppLayout>
  );
};
